/**
 * v3-organization-private-plugin-directory —— 组织私有目录端到端生命周期认证（task 5.1）。
 *
 * 单条链路串起七个环节：
 *   私有 release → 审批 → 发现 → 安装 → 禁用 → 恢复 → 回滚
 * 全程走**真实 HTTP API**（Japa apiClient）驱动既有变更流与 install lifecycle，
 * 不复制任何状态机实现。
 *
 * 两条认证红线（本文件的存在理由）：
 * - **零公众网络**：全程 `globalThis.fetch` 被替换为计数并抛错的桩；收尾断言调用数为 0，
 *   并断言不存在组织外（公众）目录路由——目录只在 `/organizations/:id/` 下可达。
 * - **零自动实例变更**：禁用/恢复/回滚（未显式选中实例）前后，对已安装行做
 *   逐字段快照比对（status/version/releaseId/rowVersion/updatedAt），任一漂移即失败。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import { seedCanaryRelease } from '../fixtures/first_party_plugin_canary_releases.js'
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import { CANARY_QUERY_PLUGIN_ID } from '@aiproj/types'

function directoryBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-directory`
}

function changeBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-change-requests`
}

function installBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-installations`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 安装行的可比较快照：任何字段漂移都意味着「自动实例变更」。 */
interface InstallationSnapshot {
  status: string
  version: string
  releaseId: number
  rowVersion: number
  updatedAt: string | null
}

async function snapshotInstallation(
  organizationId: number,
  pluginId: string,
): Promise<InstallationSnapshot> {
  const row = await PluginInstallation.query()
    .where('organization_id', organizationId)
    .where('plugin_id', pluginId)
    .firstOrFail()
  return {
    status: row.status,
    version: row.version,
    releaseId: row.releaseId,
    rowVersion: row.rowVersion,
    updatedAt: row.updatedAt?.toISO() ?? null,
  }
}

/**
 * 目录动作完整三步：创建（202，未生效）→ 异人审批 + 签发句柄 → 最终确认（生效）。
 */
async function runDirectoryChange(
  client: any,
  assert: any,
  ctx: { orgId: number; makerToken: string; checkerToken: string },
  releaseId: number,
  body: Record<string, unknown>,
) {
  const created = await client
    .post(`${directoryBase(ctx.orgId)}/releases/${releaseId}/changes`)
    .bearerToken(ctx.makerToken)
    .json(body)
  created.assertStatus(202)
  const requestUid = created.body().data.requestUid as string
  assert.isTrue(created.body().data.approvalRequired, '目录动作一律强制审批')

  const approved = await client
    .post(`${changeBase(ctx.orgId)}/${requestUid}/approve`)
    .bearerToken(ctx.checkerToken)
    .json({ idempotencyKey: `e2e-approve:${requestUid}` })
  approved.assertStatus(200)

  const handleRes = await client
    .post(`${changeBase(ctx.orgId)}/${requestUid}/confirm-handle`)
    .bearerToken(ctx.checkerToken)
    .json({})
  handleRes.assertStatus(200)
  const handle = handleRes.body().data?.handle as string
  assert.isString(handle, '应签发一次性确认句柄')

  // 句柄与签发人绑定：由持有句柄的审批人执行最终确认（他人持句柄一律 403）
  const confirmed = await client
    .post(`${directoryBase(ctx.orgId)}/changes/${requestUid}/confirm`)
    .bearerToken(ctx.checkerToken)
    .json({ handle })
  confirmed.assertStatus(200)
  return confirmed
}

/** install lifecycle 两步命令（preview → confirm）；enable 自动携带权限确认。 */
async function runInstallCommand(
  client: any,
  token: string,
  orgId: number,
  payload: Record<string, unknown>,
) {
  const preview = await client
    .post(`${installBase(orgId)}/commands/preview`)
    .bearerToken(token)
    .json(payload)
  preview.assertStatus(200)
  const data = preview.body().data
  const confirm = await client
    .post(`${installBase(orgId)}/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: data.previewHandle,
      previewDigest: data.previewDigest,
      ...(payload.action === 'enable'
        ? { permissionConfirmed: true, permissionDigest: data.permissionDigest }
        : {}),
    })
  confirm.assertStatus(200)
  return confirm
}

test.group(
  '组织私有目录端到端生命周期认证（v3-organization-private-plugin-directory 5.1）',
  (group) => {
    useAiDatabase(group)

    let externalFetchCalls: string[] = []
    let originalFetch: typeof globalThis.fetch

    group.each.setup(() => {
      externalFetchCalls = []
      originalFetch = globalThis.fetch
      // 零公众网络红线：认证期间任何 fetch 出站都被记账并直接失败
      globalThis.fetch = (async (input: unknown) => {
        externalFetchCalls.push(
          typeof input === 'string' ? input : String((input as { url?: unknown })?.url ?? input),
        )
        throw new Error('私有目录认证期间禁止外部网络')
      }) as typeof globalThis.fetch
    })

    group.each.teardown(() => {
      globalThis.fetch = originalFetch
    })

    test('私有 release→审批→发现→安装→禁用→恢复→回滚：零公众网络与零自动实例变更', async ({
      client,
      assert,
    }) => {
      // ── 世界搭建：maker（owner）/ checker（admin）/ 普通成员（viewer，发现面）──
      const owner = await createUser()
      const org = await createOrganization(owner)
      const approver = await createUser()
      await addOrgMember(org, approver, 'admin')
      const viewer = await createUser()
      await addOrgMember(org, viewer, 'viewer')

      const ownerToken = await login(client, owner.email)
      const approverToken = await login(client, approver.email)
      const viewerToken = await login(client, viewer.email)
      const ctx = { orgId: org.id, makerToken: ownerToken, checkerToken: approverToken }

      // ── ① 私有 release：历史版本 0.9.0 已批准，新版本 1.0.0 待审 ──
      const previousRelease = await seedCanaryRelease(org.id, 'query', '0.9.0')
      const currentRelease = await seedCanaryRelease(org.id, 'query', '1.0.0', {
        status: 'pending_review',
      })
      // 目录条目的推荐指针由发布流维护（本 change 之外），此处代表「1.0.0 为当前推荐」
      await PluginPrivateRegistryEntry.create({
        organizationId: org.id,
        pluginIdentity: CANARY_QUERY_PLUGIN_ID,
        pluginName: 'Canary Query (Read-Only)',
        recommendedReleaseId: currentRelease.id,
        recommendedVersion: '1.0.0',
        rowVersion: 1,
      })

      // 待审版本对普通成员不可发现（不得借目录反推待审存在性）
      const beforeApproval = await client
        .get(`${directoryBase(org.id)}/releases`)
        .bearerToken(viewerToken)
      beforeApproval.assertStatus(200)
      assert.deepEqual(
        beforeApproval.body().data.map((item: any) => item.version),
        ['0.9.0'],
        '审批前成员视图只应看到已批准的历史版本',
      )

      // ── ② 审批：走统一变更流三步，确认后才生效 ──
      await runDirectoryChange(client, assert, ctx, currentRelease.id, { action: 'approve' })
      await currentRelease.refresh()
      assert.equal(currentRelease.status, 'approved', '确认后 1.0.0 进入可分发状态')

      // ── ③ 发现：成员视图出现 1.0.0，且详情可读 ──
      const discovered = await client
        .get(`${directoryBase(org.id)}/releases?pluginIdentity=${CANARY_QUERY_PLUGIN_ID}`)
        .bearerToken(viewerToken)
      discovered.assertStatus(200)
      assert.include(
        discovered.body().data.map((item: any) => item.version),
        '1.0.0',
        '审批确认后成员即可发现新版本',
      )

      const detail = await client
        .get(`${directoryBase(org.id)}/releases/${currentRelease.id}`)
        .bearerToken(viewerToken)
      detail.assertStatus(200)
      assert.isTrue(detail.body().data.compatibility.allowed, '目录详情暴露兼容判定结论')

      // ── ④ 安装：install lifecycle 两步命令 + 显式权限确认后启用 ──
      await runInstallCommand(client, ownerToken, org.id, {
        action: 'install',
        pluginId: CANARY_QUERY_PLUGIN_ID,
        releaseId: currentRelease.id,
      })
      await runInstallCommand(client, ownerToken, org.id, {
        action: 'enable',
        pluginId: CANARY_QUERY_PLUGIN_ID,
      })
      const afterInstall = await snapshotInstallation(org.id, CANARY_QUERY_PLUGIN_ID)
      assert.equal(afterInstall.status, 'enabled')
      assert.equal(afterInstall.releaseId, currentRelease.id)

      // ── ⑤ 禁用：只阻断未来分发，已安装实例逐字段不变 ──
      await runDirectoryChange(client, assert, ctx, currentRelease.id, { action: 'disable' })
      await currentRelease.refresh()
      assert.equal(currentRelease.status, 'withdrawn', '禁用后 release 退出分发')
      assert.deepEqual(
        await snapshotInstallation(org.id, CANARY_QUERY_PLUGIN_ID),
        afterInstall,
        '禁用不得静默停用或卸载已安装实例',
      )

      // 未来分发确实被阻断：以被禁用 release 为目标的升级预览 fail closed
      const blockedUpgrade = await client
        .post(`${installBase(org.id)}/commands/preview`)
        .bearerToken(ownerToken)
        .json({
          action: 'upgrade',
          pluginId: CANARY_QUERY_PLUGIN_ID,
          releaseId: currentRelease.id,
        })
      assert.equal(
        blockedUpgrade.body().error?.code,
        'plugin-install-release-not-approved',
        '被禁用 release 不得再被分发到任何实例',
      )

      // 禁用后成员发现面同步收敛
      const afterDisableDiscovery = await client
        .get(`${directoryBase(org.id)}/releases`)
        .bearerToken(viewerToken)
      afterDisableDiscovery.assertStatus(200)
      assert.notInclude(
        afterDisableDiscovery.body().data.map((item: any) => item.version),
        '1.0.0',
        '被禁用版本不得继续出现在成员发现面',
      )

      // ── ⑥ 恢复：回到 draft 重新进入审批周期（≠ 直接恢复分发），实例仍不变 ──
      await runDirectoryChange(client, assert, ctx, currentRelease.id, { action: 'restore' })
      await currentRelease.refresh()
      assert.equal(currentRelease.status, 'draft', '恢复只把 release 送回草稿重新走审批周期')
      assert.deepEqual(
        await snapshotInstallation(org.id, CANARY_QUERY_PLUGIN_ID),
        afterInstall,
        '恢复送审同样不得改动已安装实例',
      )

      // 恢复 ≠ 恢复分发：draft 不可被直接批准，必须重新走完整审批周期
      const approveFromDraft = await client
        .post(`${directoryBase(org.id)}/releases/${currentRelease.id}/changes`)
        .bearerToken(ownerToken)
        .json({ action: 'approve' })
      assert.equal(approveFromDraft.response.status, 409)
      assert.equal(
        approveFromDraft.body().error?.code,
        'registry-illegal-status-transition',
        '恢复后的草稿不得跳过重新送审直接批准',
      )
      const stillHidden = await client
        .get(`${directoryBase(org.id)}/releases`)
        .bearerToken(viewerToken)
      stillHidden.assertStatus(200)
      assert.notInclude(
        stillHidden.body().data.map((item: any) => item.version),
        '1.0.0',
        '恢复送审期间仍不得对成员可发现',
      )

      // ── ⑦ 回滚：先看结构化预览（纯读），再走变更流切换推荐指针 ──
      const preview = await client
        .get(`${directoryBase(org.id)}/releases/${previousRelease.id}/rollback-preview`)
        .bearerToken(ownerToken)
      preview.assertStatus(200)
      const diff = preview.body().data
      assert.equal(diff.targetVersion, '0.9.0')
      assert.equal(diff.currentVersion, '1.0.0')
      assert.lengthOf(diff.blockingFindings, 0, '合法回滚目标不应有阻断项')

      // 不传 selectedInstanceIds -> 只切指针，绝不自动降级任何实例
      await runDirectoryChange(client, assert, ctx, previousRelease.id, { action: 'rollback' })

      const entry = await PluginPrivateRegistryEntry.query()
        .where('organization_id', org.id)
        .where('plugin_identity', CANARY_QUERY_PLUGIN_ID)
        .firstOrFail()
      assert.equal(entry.recommendedReleaseId, previousRelease.id, '推荐指针回到历史版本')
      assert.equal(entry.recommendedVersion, '0.9.0')
      assert.deepEqual(
        await snapshotInstallation(org.id, CANARY_QUERY_PLUGIN_ID),
        afterInstall,
        '未显式选中实例时回滚只切指针，零自动实例变更',
      )

      // ── 收尾红线 ①：零公众网络 ──
      assert.deepEqual(externalFetchCalls, [], '认证全程不得有任何外部网络调用')

      // ── 收尾红线 ②：目录只在组织作用域下可达，不存在公众入口 ──
      const publicProbe = await client
        .get('/api/v1/plugin-directory/releases')
        .bearerToken(ownerToken)
      assert.equal(publicProbe.response.status, 404, '不得存在组织外的公众目录路由')

      // ── 收尾红线 ③：全链路未产生任何组织外 release 或安装 ──
      const foreignReleases = await PluginPrivateRegistryRelease.query().whereNot(
        'organization_id',
        org.id,
      )
      const foreignInstalls = await PluginInstallation.query().whereNot('organization_id', org.id)
      assert.lengthOf(foreignReleases, 0)
      assert.lengthOf(foreignInstalls, 0)
    })
  },
)
