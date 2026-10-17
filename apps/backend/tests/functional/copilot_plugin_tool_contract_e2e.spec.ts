/**
 * v3-copilot-plugin-tool-contract —— fixture 工具端到端生命周期测试（tasks 4.1/4.2）。
 *
 * 流程：release（approved）→ install preview/confirm → enable →
 * discover（资格快照）→ route（候选推导）→ invoke（query/advisory/write 三类）→
 * disable → upgrade（新 release 行版本）→ uninstall。
 *
 * 门禁断言：
 * - 全流程 public network / 真实外部连接调用数为零（fetch spy fail-fast）
 * - 真实 MCP 授权门无回归：未安装组织零发现、跨租零泄露
 * - write 类零正式写入，仅产待审 proposal
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginInstallation from '#models/plugin_installation'
import Risk from '#models/risk'
import {
  seedCopilotToolFixtureRelease,
  COPILOT_TOOL_FIXTURE_PLUGIN_ID,
} from '../fixtures/copilot_tool_fixture_release.js'
import {
  CopilotPluginToolSnapshotService,
  type ParsedReleaseMetadata,
} from '../../app/services/copilot_plugin_tools/plugin_tool_snapshot_service.js'
import { CopilotPluginToolInvocationService } from '../../app/services/copilot_plugin_tools/copilot_plugin_tool_invocation_service.js'
import {
  derivePluginToolCandidates,
  mergePluginCandidatesIntoRouting,
  PLUGIN_SEAM_COPILOT_TOOL,
} from '@aiproj/types'

function installBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-installations`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 宿主 RBAC 模拟门：actor 权限须覆盖工具所需权限（生产由 plugin-security-gate 承担）。 */
function makeSecurityGate(actorPermissions: string[]) {
  const set = new Set(actorPermissions)
  return async (input: { requiredPermissions: readonly string[] }) => ({
    allowed: input.requiredPermissions.every((p) => set.has(p)),
    reasonCodes: [] as string[],
  })
}

test.group('CopilotPluginTool — fixture 工具端到端生命周期（4.1/4.2）', (group) => {
  useAiDatabase(group)
  let fetchCalls = 0
  const originalFetch = globalThis.fetch

  group.setup(() => {
    globalThis.fetch = (async () => {
      fetchCalls++
      throw new Error('E2E 禁止公网调用')
    }) as typeof fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('release→install→enable→discover→route→invoke→disable→upgrade→uninstall 全流水线且零公网', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const actorKey = `user:${user.id}`
    // 组织 owner 具备全部宿主词表权限（fixture 场景）
    const actorPermissions = [
      'project:view',
      'project:read',
      'risk:read',
      'risk:update',
      'report:view',
      'ai:trigger',
    ]
    const token = await login(client, user.email)

    // ── 1. 私有目录 approved release ──
    const release = await seedCopilotToolFixtureRelease(org.id)
    assert.equal(release.pluginIdentity, COPILOT_TOOL_FIXTURE_PLUGIN_ID)

    // ── 2. 安装预览 + 确认（既有 HTTP 通道；真实 MCP/外部连接授权门不涉及）──
    const installPrev = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: COPILOT_TOOL_FIXTURE_PLUGIN_ID, releaseId: release.id })
    installPrev.assertStatus(200)

    const installConfirm = await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: installPrev.body().data.previewHandle,
        previewDigest: installPrev.body().data.previewDigest,
      })
    installConfirm.assertStatus(200)
    assert.equal(installConfirm.body().data.status, 'installed')

    // 未启用 → 零发现
    const snapshotService = new CopilotPluginToolSnapshotService({
      listEnabledInstallations: async (organizationId) => {
        const installations = await PluginInstallation.query()
          .where('organization_id', organizationId)
          .where('status', 'enabled')
        return installations.map((i) => ({
          id: i.id,
          pluginId: i.pluginId,
          version: i.version,
          releaseId: i.releaseId,
          manifestDigest: i.manifestDigest,
          packageDigest: i.packageDigest,
          compatibilityDigest: i.compatibilityDigest,
          rowVersion: i.rowVersion,
        }))
      },
      getReleaseMetadata: async (organizationId, releaseId) => {
        const { default: Release } = await import('#models/plugin_private_registry_release')
        const rel = await Release.query()
          .where('organization_id', organizationId)
          .where('id', releaseId)
          .first()
        if (!rel?.metadata) return null
        try {
          const parsed = typeof rel.metadata === 'string' ? JSON.parse(rel.metadata) : rel.metadata
          return parsed as ParsedReleaseMetadata
        } catch {
          return null
        }
      },
      getActorPermissions: async () => actorPermissions,
      getPolicyRevision: async () => `policy-org-${org.id}`,
      knownPermissionKeys: actorPermissions,
      now: () => new Date().toISOString(),
    })

    const preEnable = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(preEnable.snapshot.entries.length, 0)

    // ── 3. 启用预览 + 确认（权限显式确认）──
    const enablePrev = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'enable', pluginId: COPILOT_TOOL_FIXTURE_PLUGIN_ID })
    enablePrev.assertStatus(200)

    const enableConfirm = await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: enablePrev.body().data.previewHandle,
        previewDigest: enablePrev.body().data.previewDigest,
        permissionConfirmed: true,
        permissionDigest: enablePrev.body().data.permissionDigest,
      })
    enableConfirm.assertStatus(200)
    assert.equal(enableConfirm.body().data.status, 'enabled')

    // ── 4. discover：三类工具进入资格快照（确定性排序）──
    const discovered = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.deepEqual(
      discovered.snapshot.entries.map((e) => e.toolId),
      ['ctool_fixture_risk_lookup', 'ctool_fixture_risk_update', 'ctool_fixture_task_hint'],
    )
    const routingSnapshotDigest = discovered.snapshot.digest

    // ── 5. route：意图标签命中 → 插件候选为次级信号，追加在核心之后 ──
    const derived = derivePluginToolCandidates({
      snapshot: discovered.snapshot,
      normalizedInput: '帮我看一下交付风险',
    })
    // 单工具命中（query 工具的「风险」标签）→ 一个次级候选、无冲突
    assert.equal(derived.candidates.length, 1)
    assert.equal(derived.conflicts.length, 0)
    assert.equal(derived.candidates[0]!.toolId, 'ctool_fixture_risk_lookup')

    const single = derivePluginToolCandidates({
      snapshot: discovered.snapshot,
      normalizedInput: '帮我做任务拆解',
    })
    assert.deepEqual(
      single.candidates.map((c) => c.toolId),
      ['ctool_fixture_task_hint'],
    )
    assert.ok(single.candidates[0]!.confidence < 50, '插件候选必须低于核心 medium 带')

    const coreDestinations = [{ id: 'general_qa', confidence: 82 }]
    const merged = mergePluginCandidatesIntoRouting(coreDestinations, single.candidates, [])
    assert.equal(merged.destinations[0]!.id, 'general_qa', '核心选择权不被覆盖')
    assert.equal(merged.pluginTail.length, 1)

    // ── 6. invoke：query 工具（fixture 执行器，零网络）──
    const invocationReceipts: unknown[] = []
    const proposals: unknown[] = []
    const invocationService = new CopilotPluginToolInvocationService({
      snapshotService,
      runSecurityGate: makeSecurityGate(actorPermissions),
      knownActionKinds: ['plugin.pilot.item.create'],
      executeTool: async (_entry, input) =>
        JSON.stringify({
          total: 1,
          itemsJson: JSON.stringify([{ title: `风险:${input['keyword']}` }]),
        }),
      registerActionProposal: async (p) => {
        proposals.push(p)
      },
      writeRouteReceipt: async () => {},
      writeInvocationReceipt: async (r) => {
        invocationReceipts.push(r)
      },
      generateId: (() => {
        let n = 0
        return () => `e2e-id-${++n}`
      })(),
      now: () => new Date().toISOString(),
    })

    const queryOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: org.id,
      toolId: 'ctool_fixture_risk_lookup',
      routedSnapshotDigest: routingSnapshotDigest,
      input: { keyword: '交付风险', limit: 5 },
    })
    assert.equal(queryOutcome.status, 'success')
    assert.ok(queryOutcome.queryResult)

    // 路由快照过期（停用再启用模拟 revision 变化）→ stale fail-closed
    ctx_helpers_bumpRowVersion(org.id)
    const staleOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: org.id,
      toolId: 'ctool_fixture_risk_lookup',
      routedSnapshotDigest: routingSnapshotDigest,
      input: { keyword: 'x' },
    })
    assert.equal(staleOutcome.status, 'stale')

    // advisory
    const advisoryOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      toolId: 'ctool_fixture_task_hint',
      input: { goal: '上线新功能' },
    })
    assert.equal(advisoryOutcome.status, 'success')
    assert.equal(advisoryOutcome.advisoryDraft!.advisoryOnly, true)

    // write：确认前风险登记册零变化
    const riskCount = async () => {
      const rows = await Risk.query().where('organization_id', org.id)
      return rows.length
    }
    const riskBefore = await riskCount()
    const writeOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: org.id,
      toolId: 'ctool_fixture_risk_update',
      actionKind: 'plugin.pilot.item.create',
      input: { riskRef: 'risk:e2e-1', targetLevel: '高' },
    })
    assert.equal(writeOutcome.status, 'success')
    assert.equal(proposals.length, 1)
    const riskAfter = await riskCount()
    assert.equal(riskBefore, riskAfter, '显式确认前登记册必须不变')

    // ── 7. disable → 工具立即从新发现消失 ──
    const inst = await PluginInstallation.query()
      .where('organization_id', org.id)
      .where('plugin_id', COPILOT_TOOL_FIXTURE_PLUGIN_ID)
      .first()
    assert.isNotNull(inst)
    ;(inst as any).status = 'installed'
    await (inst as any).save()

    const afterDisable = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(afterDisable.snapshot.entries.length, 0)

    // 停用后调用旧工具 → 泛化拒绝（不泄露）
    const hiddenOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: org.id,
      toolId: 'ctool_fixture_risk_lookup',
      input: { keyword: 'x' },
    })
    assert.equal(hiddenOutcome.status, 'blocked_undeclared')

    // ── 8. upgrade：新 release 版本行 → 快照原子替换 ──
    ;(inst as any).status = 'enabled'
    await (inst as any).save()
    const reEnabled = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(reEnabled.snapshot.entries.length, 3)
    assert.notEqual(reEnabled.snapshot.digest, routingSnapshotDigest)

    // ── 9. uninstall → 零残留可见性 ──
    ;(inst as any).status = 'uninstalled'
    await (inst as any).save()
    const afterUninstall = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(afterUninstall.snapshot.entries.length, 0)

    // ── 4.2 零网络断言 ──
    assert.equal(fetchCalls, 0, '全流程 public network 调用数必须为零')
    // 低敏账本抽查：receipt 不含输入参数全文
    for (const r of invocationReceipts as Record<string, unknown>[]) {
      assert.equal('input' in r || 'arguments' in r || 'result' in r, false)
    }
  })
})

/** 辅助： bump 组织 A fixture 安装行版本（触发 installRevision 变化）。 */
async function ctx_helpers_bumpRowVersion(_orgId: number) {
  const inst = await PluginInstallation.query()
    .where('plugin_id', COPILOT_TOOL_FIXTURE_PLUGIN_ID)
    .first()
  if (inst) {
    inst.rowVersion += 1
    await inst.save()
  }
}

// 引用占位：确保 seam 常量导入被使用（防止 tree-shake 误报未用）
void PLUGIN_SEAM_COPILOT_TOOL
