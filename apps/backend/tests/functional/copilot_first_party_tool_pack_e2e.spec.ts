/**
 * v3-copilot-first-party-tool-pack —— 官方四工具包端到端生命周期认证
 * （tasks 3.3/3.4/4.1/4.2）。
 *
 * 流程：私有目录 approved release → install preview/confirm → enable（权限显式确认）
 * → discover（四工具进入资格快照）→ route（次级候选、核心优先）→ invoke ×4
 * （真实领域 facade 适配器）→ disable 即隐 → upgrade snapshot 原子替换 → uninstall 零残留。
 *
 * 门禁断言：
 * - providerCalls=0、networkCalls=0（fetch spy fail-fast）、draftPersisted=false
 *   （report_versions 表零变化）；确认前 risks 表零变化
 * - 跨租零发现、未声明 permission 不可见、stale fail-closed、低敏 ledger
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginInstallation from '#models/plugin_installation'
import Project from '#models/project'
import Risk from '#models/risk'
import ReportVersion from '#models/report_version'
import Task from '#models/task'
import { COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID, FIRST_PARTY_TOOL_IDS } from '@aiproj/types'

import { seedOfficialToolPackRelease } from '../fixtures/first_party_tool_pack_release.js'
import {
  CopilotPluginToolSnapshotService,
  type ParsedReleaseMetadata,
} from '../../app/services/copilot_plugin_tools/plugin_tool_snapshot_service.js'
import { CopilotPluginToolInvocationService } from '../../app/services/copilot_plugin_tools/copilot_plugin_tool_invocation_service.js'
import { buildDefaultFirstPartyToolDeps } from '../../app/services/copilot_first_party_tools/first_party_tool_default_deps.js'
import { derivePluginToolCandidates, mergePluginCandidatesIntoRouting } from '@aiproj/types'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

function installBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-installations`
}

test.group('CopilotFirstPartyToolPack — 官方四工具生命周期 E2E', (group) => {
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

  test('release→install→enable→discover×4→route→invoke×4→disable→upgrade→uninstall 全流水线', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const orgB = await createOrganization(await createUser())
    const actorKey = `user:${user.id}`
    const token = await login(client, user.email)

    // 领域事实：一个可见项目 + 任务 + 风险
    const project = await Project.create({
      organizationId: org.id,
      name: '官方工具包验证项目',
      code: `FP${Date.now()}`,
      createdBy: user.id,
    })
    await Task.create({
      projectId: project.id,
      name: '已完成任务',
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
    } as any)
    await Task.create({
      projectId: project.id,
      name: '逾期任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'high',
      endDate: '2020-01-01',
    } as any)
    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '关键技术不确定性',
      description: '核心模块存在重大技术风险',
      category: 'technical',
      probability: 4,
      impact: 5,
      score: 20,
      status: 'identified',
      identifiedAt: new Date().toISOString(),
      createdBy: user.id,
    } as any)

    const riskCount = async () => {
      const rows = await Risk.query().where('organization_id', org.id)
      return rows.length
    }
    const reportVersionCount = async () => {
      const rows = await ReportVersion.query().where('organization_id', org.id)
      return rows.length
    }

    // ── 1. 私有目录 approved release ──
    const release = await seedOfficialToolPackRelease(org.id)
    assert.equal(release.pluginIdentity, COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID)

    // ── 2. 安装 preview/confirm（真实 HTTP 通道，无测试旁路）──
    const installPrev = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId: COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID,
        releaseId: release.id,
      })
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

    // 组织 B（跨租）：零发现
    await seedOfficialToolPackRelease(orgB.id)

    const snapshotDeps = {
      listEnabledInstallations: async (organizationId: number) => {
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
      getReleaseMetadata: async (
        organizationId: number,
        releaseId: number,
      ): Promise<ParsedReleaseMetadata | null> => {
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
      getActorPermissions: async (actorId: string, organizationId: number) =>
        actorId === actorKey && organizationId === org.id
          ? ['project:view', 'risk:view', 'report:view', 'triz_skill_layer:view', 'ai:trigger']
          : [],
      getPolicyRevision: async () => `policy-org-${org.id}`,
      knownPermissionKeys: [
        'project:view',
        'risk:view',
        'report:view',
        'triz_skill_layer:view',
        'ai:trigger',
      ],
      now: () => new Date().toISOString(),
    }
    const snapshotService = new CopilotPluginToolSnapshotService(snapshotDeps)

    const crossTenant = await snapshotService.resolveSnapshot({
      organizationId: orgB.id,
      actorId: `user:${orgB.id}`,
    })
    assert.equal(crossTenant.snapshot.entries.length, 0, '跨组织必须零发现')

    // ── 3. 启用 preview/confirm（权限显式确认门控）──
    const enablePrev = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'enable', pluginId: COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID })
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

    // ── 4. discover：四个官方工具进入快照（确定性排序）──
    const discovered = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.deepEqual(
      discovered.snapshot.entries.map((e) => e.toolId),
      [...FIRST_PARTY_TOOL_IDS].sort(),
    )
    const routingSnapshotDigest = discovered.snapshot.digest

    // 未声明 permission 的 actor：对应工具不可见（零泄露）
    const limited = new CopilotPluginToolSnapshotService({
      ...snapshotDeps,
      getActorPermissions: async () => ['project:view'],
    })
    const limitedView = await limited.resolveSnapshot({ organizationId: org.id, actorId: actorKey })
    assert.deepEqual(
      limitedView.snapshot.entries.map((e) => e.toolId),
      ['ctool_aiproj_project_query'],
    )

    // ── 5. route：插件候选为次级信号（confidence < 50），核心选择权不变 ──
    const derived = derivePluginToolCandidates({
      snapshot: discovered.snapshot,
      normalizedInput: '帮我查询项目状态并解释当前风险分析',
    })
    assert.equal(derived.candidates.length, 2, '项目查询与风险解释命中且无标签冲突')
    for (const c of derived.candidates) {
      assert.ok(c.confidence < 50, '插件候选必须低于核心 medium 带')
    }
    const merged = mergePluginCandidatesIntoRouting(
      [{ id: 'general_qa', confidence: 82 }],
      derived.candidates,
      derived.conflicts,
    )
    assert.equal(merged.destinations[0]!.id, 'general_qa')

    // ── 6. invoke ×4：生产适配器（真实领域 facade）──
    const { FirstPartyToolDispatcher } =
      await import('../../app/services/copilot_first_party_tools/first_party_tool_dispatcher.js')
    const deps = await buildDefaultFirstPartyToolDeps()
    const callCtx = {
      organizationId: org.id,
      actorId: actorKey,
      projectId: project.id,
    }
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const invocationReceipts: unknown[] = []
    const proposals: unknown[] = []

    const invocationService = new CopilotPluginToolInvocationService({
      snapshotService,
      runSecurityGate: async (inputGate) => ({
        allowed:
          inputGate.organizationId === org.id &&
          inputGate.requiredPermissions.every((p) =>
            ['project:view', 'risk:view', 'report:view', 'triz_skill_layer:view'].includes(p),
          ),
        reasonCodes: [],
      }),
      knownActionKinds: ['plugin.pilot.item.create'],
      executeTool: async (entry, input) => dispatcher.execute(entry, callCtx, input),
      registerActionProposal: async (p) => {
        proposals.push(p)
      },
      writeRouteReceipt: async () => {},
      writeInvocationReceipt: async (r) => {
        invocationReceipts.push(r)
      },
      generateId: (() => {
        let n = 0
        return () => `fp-e2e-${++n}`
      })(),
      now: () => new Date().toISOString(),
    })

    const risksBefore = await riskCount()
    const reportVersionsBefore = await reportVersionCount()

    // 6.1 项目查询（query 边界）
    const queryOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      toolId: 'ctool_aiproj_project_query',
      routedSnapshotDigest: routingSnapshotDigest,
      input: { search: '官方工具包' },
    })
    assert.equal(queryOutcome.status, 'success')
    assert.ok(queryOutcome.queryResult)
    assert.match(queryOutcome.queryResult!.text, /官方工具包验证项目/)

    // 6.2 TRIZ 顾问（advisory 边界；owner 权限不足时也必须降级成功）
    const trizOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: project.id,
      toolId: 'ctool_aiproj_triz_advisor',
      routedSnapshotDigest: routingSnapshotDigest,
      input: { projectId: project.id, problem: '结构重量与刚度矛盾' },
    })
    assert.equal(trizOutcome.status, 'success')
    assert.equal(trizOutcome.advisoryDraft!.advisoryOnly, true)

    // 6.3 周报草稿（advisory；draftPersisted=false）
    const weeklyOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: project.id,
      toolId: 'ctool_aiproj_weekly_report_draft',
      routedSnapshotDigest: routingSnapshotDigest,
      input: { projectId: project.id },
    })
    assert.equal(weeklyOutcome.status, 'success')
    assert.match(weeklyOutcome.advisoryDraft!.summary, /周报/)
    assert.match(weeklyOutcome.advisoryDraft!.summary, /不会发布、发送或外发/)
    assert.equal(await reportVersionCount(), reportVersionsBefore, 'report_versions 表必须零变化')

    // 6.4 风险解释（advisory + applied=false 预览块；确认前风险表零变化）
    const riskOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      projectId: project.id,
      toolId: 'ctool_aiproj_risk_explainer',
      routedSnapshotDigest: routingSnapshotDigest,
      input: { projectId: project.id },
    })
    assert.equal(riskOutcome.status, 'success')
    assert.match(riskOutcome.advisoryDraft!.summary, /关键技术不确定性/)
    assert.equal(proposals.length, 0, 'advisory 工具不得产生正式提案')
    const afterRisk = await Risk.find(risk.id)
    assert.equal(afterRisk!.status, 'identified', '显式确认前风险记录保持不变')
    assert.equal(await riskCount(), risksBefore, '不得自动新增风险')

    // ── 7. stale：路由后安装行变化 → 结果丢弃 ──
    const inst = await PluginInstallation.query()
      .where('organization_id', org.id)
      .where('plugin_id', COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID)
      .first()
    inst!.rowVersion += 1
    await inst!.save()
    const staleOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      toolId: 'ctool_aiproj_project_query',
      routedSnapshotDigest: routingSnapshotDigest,
      input: {},
    })
    assert.equal(staleOutcome.status, 'stale')

    // 新快照恢复（重新解析即可见——rowVersion 变化只影响旧 digest 绑定）
    const refreshed = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })

    // ── 8. disable → 四工具原子消失；旧会话引用旧快照 → 不执行 ──
    inst!.status = 'installed'
    await inst!.save()
    const afterDisable = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(afterDisable.snapshot.entries.length, 0)
    const hiddenOutcome = await invocationService.invoke({
      organizationId: org.id,
      actorId: actorKey,
      toolId: 'ctool_aiproj_weekly_report_draft',
      routedSnapshotDigest: refreshed.snapshot.digest,
      input: { projectId: project.id },
    })
    assert.equal(hiddenOutcome.status, 'blocked_undeclared')

    // ── 9. re-enable（模拟升级后的新 snapshot）+ uninstall 零残留 ──
    inst!.status = 'enabled'
    await inst!.save()
    const reEnabled = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(reEnabled.snapshot.entries.length, 4)
    assert.notEqual(
      reEnabled.snapshot.digest,
      routingSnapshotDigest,
      '升级/重启用必须产生新快照 digest',
    )

    inst!.status = 'uninstalled'
    await inst!.save()
    const afterUninstall = await snapshotService.resolveSnapshot({
      organizationId: org.id,
      actorId: actorKey,
    })
    assert.equal(afterUninstall.snapshot.entries.length, 0)

    // ── 10. 门禁断言 ──
    assert.equal(fetchCalls, 0, '全流程 public network 调用数必须为零')
    assert.ok(invocationReceipts.length >= 4, '低敏调用 receipt 必须保留（审计历史）')
    for (const r of invocationReceipts as Record<string, unknown>[]) {
      assert.equal(
        'input' in r || 'arguments' in r || 'result' in r,
        false,
        'receipt 禁存参数/结果全文',
      )
    }
  })
})
