/**
 * v3-organization-private-plugin-directory — 目录受控管理动作集成测试
 * （tasks 3.2 / 3.4 / 3.6）。
 *
 * 覆盖三组红线：
 * - **3.2 提交门**：maker-checker、自审拒绝、审批 ≠ 确认（确认前领域零变化）、
 *   stale 绑定失效、一次性句柄不可重放、审计 receipt 与领域提交同事务。
 * - **3.4 禁用语义**：禁用只阻断未来分发，**绝不**静默停用/卸载已安装实例；
 *   已安装历史保持；跨租影响清单不泄露。
 * - **3.6 回滚判定**：不兼容目标 / 损坏 release / 权限升级一律 blocking 且拒绝提交；
 *   重复确认被拒；成功回滚只切换推荐指针并委托既有 install lifecycle。
 *
 * 全程本地测试库与 fixture，零外部网络、零真实 provider。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import PluginInstallation from '#models/plugin_installation'
import PluginChangeRequest from '#models/plugin_change_request'
import AuditLog from '#models/audit_log'
import type { RegistryReleaseStatus } from '@aiproj/types'

const PLUGIN_ID = 'com.example.directory-flow'

function directoryBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-directory`
}

function changeBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-change-requests`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 兼容的 compatibility matrix（通过 evaluateCurrentReleaseApproval 审批门）。 */
function compatibleMetadata(permissionKeys: string[] = ['project:view']): string {
  return JSON.stringify({
    compatibilityMatrix: {
      pluginVersion: '1.0.0',
      hostRange: '>=3.0.0 <4.0.0',
      manifestSchemaVersion: '1.0',
      permissionModelVersion: '1.0',
      channel: 'stable',
      requiredSeams: [{ seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' }],
    },
    permissions: permissionKeys.map((permissionKey) => ({ permissionKey })),
  })
}

/** 宿主范围写死在未来主版本 -> 兼容门必然拒绝。 */
function incompatibleMetadata(): string {
  return JSON.stringify({
    compatibilityMatrix: {
      pluginVersion: '1.0.0',
      hostRange: '>=99.0.0 <100.0.0',
      manifestSchemaVersion: '1.0',
      permissionModelVersion: '1.0',
      channel: 'stable',
      requiredSeams: [],
    },
    permissions: [{ permissionKey: 'project:view' }],
  })
}

async function seedRelease(
  organizationId: number,
  overrides: Partial<{
    pluginIdentity: string
    version: string
    status: RegistryReleaseStatus
    metadata: string | null
    packageDigest: string
    manifestDigest: string
  }> = {},
) {
  return PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: overrides.pluginIdentity ?? PLUGIN_ID,
    version: overrides.version ?? '1.0.0',
    packageDigest: overrides.packageDigest === undefined ? 'sha256:pkg' : overrides.packageDigest,
    manifestDigest:
      overrides.manifestDigest === undefined ? 'sha256:manifest' : overrides.manifestDigest,
    compatibilityDigest: 'sha256:compat',
    upstreamReceiptRef: 'receipt-1',
    status: overrides.status ?? 'approved',
    metadata: overrides.metadata === undefined ? compatibleMetadata() : overrides.metadata,
    rowVersion: 1,
  })
}

async function seedEntry(
  organizationId: number,
  recommendedReleaseId: number,
  recommendedVersion: string,
) {
  return PluginPrivateRegistryEntry.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    pluginName: '目录流程测试插件',
    recommendedReleaseId,
    recommendedVersion,
    rowVersion: 1,
  })
}

/** `(organization_id, plugin_id)` 唯一：同组织多行须给不同 pluginId。 */
async function seedInstallation(
  organizationId: number,
  releaseId: number,
  version: string,
  status: 'installed' | 'enabled' | 'uninstalled' = 'enabled',
  pluginId: string = PLUGIN_ID,
) {
  return PluginInstallation.create({
    organizationId,
    pluginId,
    version,
    releaseId,
    status,
    packageDigest: 'sha256:pkg',
    manifestDigest: 'sha256:manifest',
    compatibilityDigest: 'sha256:compat',
    rowVersion: 1,
  })
}

/**
 * 建立「发起人 + 审批人」双人世界（maker-checker 的最小前提）。
 * owner 发起，admin 审批：两者是不同自然人，满足自审禁止。
 */
async function seedTwoPersonOrg(client: any) {
  const owner = await createUser()
  const org = await createOrganization(owner)
  const approver = await createUser()
  await addOrgMember(org, approver, 'admin')
  return {
    org,
    owner,
    approver,
    ownerToken: await login(client, owner.email),
    approverToken: await login(client, approver.email),
  }
}

/** 创建目录变更请求，返回 HTTP 响应（不做断言，便于负例复用）。 */
function createChange(
  client: any,
  token: string,
  orgId: number,
  releaseId: number,
  body: Record<string, unknown>,
) {
  return client
    .post(`${directoryBase(orgId)}/releases/${releaseId}/changes`)
    .bearerToken(token)
    .json(body)
}

/** 审批 + 签发句柄，返回一次性 handle。 */
async function approveAndIssueHandle(
  client: any,
  approverToken: string,
  orgId: number,
  requestUid: string,
  assert: any,
): Promise<string> {
  const approved = await client
    .post(`${changeBase(orgId)}/${requestUid}/approve`)
    .bearerToken(approverToken)
    .json({ idempotencyKey: `approve:${requestUid}` })
  approved.assertStatus(200)

  const handleRes = await client
    .post(`${changeBase(orgId)}/${requestUid}/confirm-handle`)
    .bearerToken(approverToken)
    .json({})
  handleRes.assertStatus(200)
  const handle = handleRes.body().data?.handle
  assert.isString(handle, '应签发一次性确认句柄')
  return handle as string
}

function confirmChange(
  client: any,
  token: string,
  orgId: number,
  requestUid: string,
  handle: string,
) {
  return client
    .post(`${directoryBase(orgId)}/changes/${requestUid}/confirm`)
    .bearerToken(token)
    .json({ handle })
}

test.group('PluginDirectory 受控管理动作（统一变更流）', (group) => {
  useAiDatabase(group)

  // ══════════════════════════════════════════════════════════════════════
  // 3.2 提交门：maker-checker / 自审拒绝 / 审批≠确认 / stale / replay / 审计
  // ══════════════════════════════════════════════════════════════════════

  test('审批 ≠ 确认：approve 后 release 状态零变化，confirm 后才生效', async ({
    client,
    assert,
  }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid
    assert.isString(requestUid)
    assert.isTrue(created.body().data.approvalRequired, '目录动作一律强制审批')

    // 创建后：领域零变化
    await release.refresh()
    assert.equal(release.status, 'pending_review', '创建变更请求不得改动 release')

    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)

    // 审批后、确认前：领域仍然零变化（审批 ≠ 生效）
    await release.refresh()
    assert.equal(release.status, 'pending_review', '审批不得使变更生效')

    const confirmed = await confirmChange(client, approverToken, org.id, requestUid, handle)
    confirmed.assertStatus(200)

    await release.refresh()
    assert.equal(release.status, 'approved', '确认后状态机推进到 approved')
  })

  test('自审拒绝：发起人不得审批自己的目录变更请求', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid

    const selfApprove = await client
      .post(`${changeBase(org.id)}/${requestUid}/approve`)
      .bearerToken(ownerToken)
      .json({ idempotencyKey: `self:${requestUid}` })
    selfApprove.assertStatus(403)
    assert.equal(selfApprove.body().error.code, 'plugin-change-self-approval-denied')

    await release.refresh()
    assert.equal(release.status, 'pending_review', '自审被拒后领域零变化')
  })

  test('stale：确认前 release 发生漂移则确认失败且状态保持', async ({ client, assert }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)

    // 旁路漂移：rowVersion 前进，使 targetRevision 绑定过期
    release.rowVersion += 1
    await release.save()

    const confirmed = await confirmChange(client, approverToken, org.id, requestUid, handle)
    assert.notEqual(confirmed.status(), 200, 'stale 绑定必须 fail closed')

    await release.refresh()
    assert.equal(release.status, 'pending_review', 'stale 失败后状态零变化')
  })

  test('replay：一次性句柄第二次确认被拒且不重复应用', async ({ client, assert }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)

    const first = await confirmChange(client, approverToken, org.id, requestUid, handle)
    first.assertStatus(200)
    await release.refresh()
    const versionAfterFirst = release.rowVersion

    const replay = await confirmChange(client, approverToken, org.id, requestUid, handle)
    assert.notEqual(replay.status(), 200, '句柄一次性：重放必须被拒')

    await release.refresh()
    assert.equal(release.rowVersion, versionAfterFirst, '重放不得二次写入领域')
  })

  test('审计 receipt 与领域提交同事务：确认成功即有低敏 apply 审计', async ({ client, assert }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)
    const confirmed = await confirmChange(client, approverToken, org.id, requestUid, handle)
    confirmed.assertStatus(200)

    const audits = await AuditLog.query().where('organization_id', org.id).where('action', 'apply')
    assert.isAtLeast(audits.length, 1, 'apply 必须留下可信审计 receipt')

    // 低敏：审计不得回显 package/manifest digest 原文
    const serialized = JSON.stringify(audits.map((a) => a.serialize()))
    assert.notInclude(serialized, 'sha256:pkg', '审计不得回显 package digest 原文')
    assert.notInclude(serialized, 'sha256:manifest', '审计不得回显 manifest digest 原文')
  })

  test('目录写入口一律经统一变更流：确认后必有 registry-release-change 请求行', async ({
    client,
    assert,
  }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)
    await confirmChange(client, approverToken, org.id, requestUid, handle)

    const rows = await PluginChangeRequest.query()
      .where('organization_id', org.id)
      .where('kind', 'registry-release-change')
    assert.lengthOf(rows, 1, '每次目录动作恰好一条统一变更流请求')
    assert.equal(rows[0].requestUid, requestUid)
  })

  test('共享确认端点对目录 kind fail closed（apply delegate 不得跨领域误用）', async ({
    client,
    assert,
  }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)

    // 走共享 /plugin-change-requests/:uid/confirm（三类核心 kind 专用）
    const wrongEndpoint = await client
      .post(`${changeBase(org.id)}/${requestUid}/confirm`)
      .bearerToken(approverToken)
      .json({ handle })
    wrongEndpoint.assertStatus(400)
    assert.equal(wrongEndpoint.body().error.code, 'plugin-change-payload-invalid')

    await release.refresh()
    assert.equal(release.status, 'pending_review', '错误端点不得产生任何领域写入')
  })

  test('权限不足者不得发起目录动作（先 404 后 403 的非泄露顺序保持）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const viewerToken = await login(client, viewer.email)
    const release = await seedRelease(org.id, { status: 'pending_review' })

    // 同组织内存在 -> 谈权限（403）
    const denied = await createChange(client, viewerToken, org.id, release.id, {
      action: 'approve',
    })
    assert.equal(denied.status(), 403)

    // 跨组织目标 -> 一律「不存在」（404），不得用 403 反证存在性
    const otherOwner = await createUser()
    const otherOrg = await createOrganization(otherOwner)
    const foreign = await seedRelease(otherOrg.id, { status: 'pending_review' })
    const ownerToken = await login(client, owner.email)
    const crossTenant = await createChange(client, ownerToken, org.id, foreign.id, {
      action: 'approve',
    })
    assert.equal(crossTenant.status(), 404)
    assert.equal(
      crossTenant.body().error.code,
      'directory-release-not-found',
      '跨租一律回「不存在」，不得暴露归属组织',
    )

    await release.refresh()
    assert.equal(release.status, 'pending_review')
  })

  // ══════════════════════════════════════════════════════════════════════
  // 3.4 禁用只阻断未来分发（绝不静默停用/卸载实例）
  // ══════════════════════════════════════════════════════════════════════

  test('禁用生效后 release 撤回，但已安装实例状态逐行零变化', async ({ client, assert }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'approved' })
    const enabled = await seedInstallation(org.id, release.id, '1.0.0', 'enabled')
    const installed = await seedInstallation(
      org.id,
      release.id,
      '1.0.0',
      'installed',
      `${PLUGIN_ID}.second`,
    )

    const before = await PluginInstallation.query()
      .where('organization_id', org.id)
      .orderBy('id', 'asc')
    const beforeSnapshot = before.map((row) => ({
      id: row.id,
      status: row.status,
      version: row.version,
      releaseId: row.releaseId,
      rowVersion: row.rowVersion,
      uninstalledAt: row.uninstalledAt?.toISO() ?? null,
    }))

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'disable',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)
    const confirmed = await confirmChange(client, approverToken, org.id, requestUid, handle)
    confirmed.assertStatus(200)

    await release.refresh()
    assert.equal(release.status, 'withdrawn', '禁用把 release 移出可分发集合')

    const after = await PluginInstallation.query()
      .where('organization_id', org.id)
      .orderBy('id', 'asc')
    const afterSnapshot = after.map((row) => ({
      id: row.id,
      status: row.status,
      version: row.version,
      releaseId: row.releaseId,
      rowVersion: row.rowVersion,
      uninstalledAt: row.uninstalledAt?.toISO() ?? null,
    }))
    assert.deepEqual(afterSnapshot, beforeSnapshot, '禁用绝不静默停用或卸载任何实例')

    await enabled.refresh()
    await installed.refresh()
    assert.equal(enabled.status, 'enabled')
    assert.equal(installed.status, 'installed')
  })

  test('禁用后已安装历史保持：成员目录不再可见，但安装记录与版本仍可解释', async ({
    client,
    assert,
  }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'approved' })
    await seedInstallation(org.id, release.id, '1.0.0', 'enabled')

    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const memberToken = await login(client, member.email)

    const visibleBefore = await client
      .get(`${directoryBase(org.id)}/releases`)
      .bearerToken(memberToken)
    visibleBefore.assertStatus(200)
    assert.lengthOf(visibleBefore.body().data, 1, '禁用前成员可见该 release')

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'disable',
    })
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)
    await confirmChange(client, approverToken, org.id, requestUid, handle)

    const visibleAfter = await client
      .get(`${directoryBase(org.id)}/releases`)
      .bearerToken(memberToken)
    visibleAfter.assertStatus(200)
    assert.lengthOf(visibleAfter.body().data, 0, '禁用后成员目录不再返回该 release')

    // 已安装历史仍在（可解释、可审计）
    const installs = await PluginInstallation.query()
      .where('organization_id', org.id)
      .where('release_id', release.id)
    assert.lengthOf(installs, 1)
    assert.equal(installs[0].status, 'enabled')
    assert.equal(installs[0].version, '1.0.0')
  })

  test('跨租影响清单不泄露：他组织安装既不计数也不出现在清单', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'approved' })
    await seedInstallation(org.id, release.id, '1.0.0', 'enabled')

    // 他组织在同一 pluginIdentity 上自建 release 与安装
    const otherOwner = await createUser()
    const otherOrg = await createOrganization(otherOwner)
    const foreignRelease = await seedRelease(otherOrg.id, { status: 'approved' })
    const foreignA = await seedInstallation(otherOrg.id, foreignRelease.id, '1.0.0', 'enabled')
    const foreignB = await seedInstallation(
      otherOrg.id,
      foreignRelease.id,
      '1.0.0',
      'installed',
      `${PLUGIN_ID}.second`,
    )

    const affected = await client
      .get(`${directoryBase(org.id)}/releases/${release.id}/affected-installations`)
      .bearerToken(ownerToken)
    affected.assertStatus(200)
    assert.equal(affected.body().meta.total, 1, '影响计数只含本组织安装')

    const ids = (affected.body().data as Array<{ id: string }>).map((row) => row.id)
    assert.notInclude(ids, String(foreignA.id), '影响清单不得含他组织安装行')
    assert.notInclude(ids, String(foreignB.id), '影响清单不得含他组织安装行')
  })

  // ══════════════════════════════════════════════════════════════════════
  // 3.6 回滚：blocking 判定与 install lifecycle 委托
  // ══════════════════════════════════════════════════════════════════════

  test('回滚目标不兼容：预览标记 blocking 且提交被拒（预览与提交同源）', async ({
    client,
    assert,
  }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const current = await seedRelease(org.id, { version: '2.0.0', status: 'approved' })
    const target = await seedRelease(org.id, {
      version: '1.0.0',
      status: 'approved',
      metadata: incompatibleMetadata(),
    })
    await seedEntry(org.id, current.id, '2.0.0')

    const preview = await client
      .get(`${directoryBase(org.id)}/releases/${target.id}/rollback-preview`)
      .bearerToken(ownerToken)
    preview.assertStatus(200)
    assert.include(
      preview.body().data.blockingFindings,
      'rollback-target-incompatible',
      '不兼容目标必须标记 blocking',
    )

    const created = await createChange(client, ownerToken, org.id, target.id, {
      action: 'rollback',
    })
    assert.equal(created.status(), 409, '存在阻断项时不得创建提交')

    const rows = await PluginChangeRequest.query().where('organization_id', org.id)
    assert.lengthOf(rows, 0, '被拒的回滚不得留下任何变更请求行')
  })

  test('回滚目标完整性损坏（缺 digest）：blocking 且拒绝提交', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const current = await seedRelease(org.id, { version: '2.0.0', status: 'approved' })
    const target = await seedRelease(org.id, {
      version: '1.0.0',
      status: 'approved',
      // digest 列 NOT NULL：完整性缺失在库内表现为空串（`!digest` 同样判 falsy）。
      packageDigest: '',
    })
    await seedEntry(org.id, current.id, '2.0.0')

    const preview = await client
      .get(`${directoryBase(org.id)}/releases/${target.id}/rollback-preview`)
      .bearerToken(ownerToken)
    preview.assertStatus(200)
    assert.include(
      preview.body().data.blockingFindings,
      'rollback-target-integrity-incomplete',
      '损坏 release 必须标记 blocking',
    )

    const created = await createChange(client, ownerToken, org.id, target.id, {
      action: 'rollback',
    })
    assert.equal(created.status(), 409)
  })

  test('回滚构成权限升级：blocking 且拒绝（提权不得借回滚洗白）', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const current = await seedRelease(org.id, {
      version: '2.0.0',
      status: 'approved',
      metadata: compatibleMetadata(['project:view']),
    })
    const target = await seedRelease(org.id, {
      version: '1.0.0',
      status: 'approved',
      metadata: compatibleMetadata(['project:view', 'risk:view']),
    })
    await seedEntry(org.id, current.id, '2.0.0')

    const preview = await client
      .get(`${directoryBase(org.id)}/releases/${target.id}/rollback-preview`)
      .bearerToken(ownerToken)
    preview.assertStatus(200)
    const body = preview.body().data
    assert.include(body.blockingFindings, 'rollback-permission-elevation')
    assert.include(body.permissionDelta.added, 'risk:view', '差异应逐 key 列出净新增')

    const created = await createChange(client, ownerToken, org.id, target.id, {
      action: 'rollback',
    })
    assert.equal(created.status(), 409)
  })

  test('回滚目标即当前推荐版本：前置拒绝且不进入变更流', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const current = await seedRelease(org.id, { version: '2.0.0', status: 'approved' })
    await seedEntry(org.id, current.id, '2.0.0')

    const preview = await client
      .get(`${directoryBase(org.id)}/releases/${current.id}/rollback-preview`)
      .bearerToken(ownerToken)
    assert.equal(preview.status(), 409)
    assert.equal(preview.body().error.code, 'registry-rollback-target-invalid')

    const created = await createChange(client, ownerToken, org.id, current.id, {
      action: 'rollback',
    })
    assert.equal(created.status(), 409)
  })

  test('成功回滚：推荐指针切换到历史 release，安装实例不被自动改写', async ({ client, assert }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const target = await seedRelease(org.id, { version: '1.0.0', status: 'approved' })
    const current = await seedRelease(org.id, { version: '2.0.0', status: 'approved' })
    const entry = await seedEntry(org.id, current.id, '2.0.0')
    const installation = await seedInstallation(org.id, current.id, '2.0.0', 'enabled')

    const preview = await client
      .get(`${directoryBase(org.id)}/releases/${target.id}/rollback-preview`)
      .bearerToken(ownerToken)
    preview.assertStatus(200)
    assert.lengthOf(preview.body().data.blockingFindings, 0, '干净目标无阻断项')
    assert.equal(preview.body().data.targetVersion, '1.0.0')
    assert.equal(preview.body().data.currentVersion, '2.0.0')

    const created = await createChange(client, ownerToken, org.id, target.id, {
      action: 'rollback',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid

    // 确认前：推荐指针与安装实例均零变化
    await entry.refresh()
    assert.equal(entry.recommendedReleaseId, current.id, '确认前指针不得移动')

    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)
    const confirmed = await confirmChange(client, approverToken, org.id, requestUid, handle)
    confirmed.assertStatus(200)

    await entry.refresh()
    assert.equal(entry.recommendedReleaseId, target.id, '确认后指针切到历史 release')
    assert.equal(entry.recommendedVersion, '1.0.0')

    // 未显式选中的实例不被自动降级（无自动执行红线）
    await installation.refresh()
    assert.equal(installation.status, 'enabled')
    assert.equal(installation.version, '2.0.0', '未选中的实例版本不得被自动改写')
  })

  test('回滚重复确认：第二次确认被拒且指针不再移动', async ({ client, assert }) => {
    const { org, ownerToken, approverToken } = await seedTwoPersonOrg(client)
    const target = await seedRelease(org.id, { version: '1.0.0', status: 'approved' })
    const current = await seedRelease(org.id, { version: '2.0.0', status: 'approved' })
    const entry = await seedEntry(org.id, current.id, '2.0.0')

    const created = await createChange(client, ownerToken, org.id, target.id, {
      action: 'rollback',
    })
    created.assertStatus(202)
    const requestUid = created.body().data.requestUid
    const handle = await approveAndIssueHandle(client, approverToken, org.id, requestUid, assert)

    const first = await confirmChange(client, approverToken, org.id, requestUid, handle)
    first.assertStatus(200)
    await entry.refresh()
    assert.equal(entry.recommendedReleaseId, target.id)

    const replay = await confirmChange(client, approverToken, org.id, requestUid, handle)
    assert.notEqual(replay.status(), 200)

    await entry.refresh()
    assert.equal(entry.recommendedReleaseId, target.id, '重放不得二次移动指针')
  })

  test('非法动作枚举被校验拒绝，且不产生任何变更请求', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'approved' })

    const bad = await createChange(client, ownerToken, org.id, release.id, {
      action: 'uninstall-everything',
    })
    assert.oneOf(bad.status(), [400, 422])

    const rows = await PluginChangeRequest.query().where('organization_id', org.id)
    assert.lengthOf(rows, 0)
  })

  test('非法状态转换被状态机拒绝（withdrawn 不可再次 approve）', async ({ client, assert }) => {
    const { org, ownerToken } = await seedTwoPersonOrg(client)
    const release = await seedRelease(org.id, { status: 'withdrawn' })

    const created = await createChange(client, ownerToken, org.id, release.id, {
      action: 'approve',
    })
    assert.equal(created.status(), 409, '非法转换必须在创建阶段 fail closed')

    const rows = await PluginChangeRequest.query().where('organization_id', org.id)
    assert.lengthOf(rows, 0)
  })
})
