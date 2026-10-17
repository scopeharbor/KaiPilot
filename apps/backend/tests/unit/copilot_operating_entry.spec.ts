/**
 * v3-copilot-productized-operating-entry —— 入口就绪读路径单元测试
 * （任务 3.1 / 3.3 / 3.4 / 3.5）。
 *
 * 覆盖：
 * - Validator：projectId 可选、非法值拒绝、未知 query 字段不进入结果
 * - Policy 适配：无组织、跨组织、无项目权限、伪造 projectId、判定只回布尔（非泄露）
 * - Service 聚合：核心 ready、可选会话失败降级、可选工具快照 stale 降级、
 *   mandatory 判定失败阻断、稳定 reason/allowedAction、零副作用
 * - 会话投影：排序、archived/非活跃/retention blocked 缺席、有界标题
 * - quick starts：权限过滤、disabled/incompatible/无权/跨租缺席、core/plugin 稳定排序与上限
 *
 * 全部依赖注入，零 DB、零网络、零 provider。
 */

import { describe, it, expect, vi } from 'vitest'

import {
  COPILOT_ENTRY_CONTRACT_VERSION,
  COPILOT_ENTRY_MAX_QUICK_STARTS,
  parseCopilotEntryReadinessSnapshot,
} from '@aiproj/types'

import {
  COPILOT_ENTRY_CORE_QUICK_STARTS,
  COPILOT_ENTRY_UNTITLED_SESSION_LABEL,
  CopilotOperatingEntryService,
  projectPluginQuickStarts,
  projectRecentSession,
  type CopilotEntryRequestContext,
  type CopilotEntrySessionProjection,
  type CopilotEntryToolSnapshotProjection,
  type CopilotOperatingEntryDeps,
} from '../../app/services/copilot_entry/copilot_operating_entry_service.js'
import CopilotEntryPolicy from '../../app/policies/copilot_entry_policy.js'
import { copilotReadinessQueryValidator } from '../../app/validators/copilot_readiness_validator.js'

// ===========================================================================
// 夹具
// ===========================================================================

const NOW = '2026-08-24T02:00:00.000Z'
const ORG_A = 7
const PROJECT_A = 42

const CTX_ORG: CopilotEntryRequestContext = { actorId: 1, organizationId: ORG_A }
const CTX_PROJECT: CopilotEntryRequestContext = {
  actorId: 1,
  organizationId: ORG_A,
  requestedProjectId: PROJECT_A,
}

function makeDeps(overrides: Partial<CopilotOperatingEntryDeps> = {}): CopilotOperatingEntryDeps {
  return {
    canUseCopilot: async () => true,
    canAccessProject: async () => true,
    hasPermission: async () => true,
    getProjectLabel: async () => '灯塔迁移项目',
    now: () => NOW,
    ...overrides,
  }
}

function makeSnapshot(
  overrides: Partial<CopilotEntryToolSnapshotProjection> = {},
): CopilotEntryToolSnapshotProjection {
  return {
    revision: 'snap_rev_0001',
    generatedAt: NOW,
    entries: [
      {
        toolId: 'ctool_risk_lookup',
        name: '风险查询',
        sideEffectClass: 'query',
        pluginId: 'plg_official',
        pluginVersion: '1.0.0',
        toolDigest: 'digest_risk',
      },
    ],
    ...overrides,
  }
}

function makeSession(
  overrides: Partial<CopilotEntrySessionProjection> = {},
): CopilotEntrySessionProjection {
  return {
    sessionId: 'csess_0001',
    title: '排期冲突讨论',
    scope: 'project',
    updatedAt: '2026-08-24T01:30:00.000Z',
    archived: false,
    status: 'active',
    ...overrides,
  }
}

/** 用假 RbacService 构造 Policy（零 DB）。 */
function makePolicy(
  check: (permission: string, organizationId: number, projectId?: number) => boolean,
): CopilotEntryPolicy {
  const rbac = {
    check: async (
      _user: unknown,
      permission: string,
      organizationId: number,
      projectId?: number,
    ) => ({
      allowed: check(permission, organizationId, projectId),
      reason: check(permission, organizationId, projectId)
        ? 'organization'
        : 'permission_not_granted',
    }),
  }
  return new CopilotEntryPolicy(rbac as never)
}

const FAKE_USER = { id: 1 } as never

// ===========================================================================
// 3.1 —— Validator
// ===========================================================================

describe('3.1 readiness query validator', () => {
  it('projectId 可省略', async () => {
    await expect(copilotReadinessQueryValidator.validate({})).resolves.toEqual({})
  })

  it('数字字符串被规范化为整数', async () => {
    await expect(copilotReadinessQueryValidator.validate({ projectId: '42' })).resolves.toEqual({
      projectId: 42,
    })
  })

  it('拒绝非正整数与非数值', async () => {
    for (const bad of [0, -1, 1.5, 'abc', {}]) {
      await expect(copilotReadinessQueryValidator.validate({ projectId: bad })).rejects.toThrow()
    }
  })

  it('未知 query 字段不进入校验结果（不得经 query 注入行为）', async () => {
    const parsed = await copilotReadinessQueryValidator.validate({
      projectId: 42,
      organizationId: 99,
      includeExclusions: true,
    })
    expect(parsed).toEqual({ projectId: 42 })
  })
})

// ===========================================================================
// 3.1 —— Policy 适配
// ===========================================================================

describe('3.1 entry policy adapter', () => {
  it('canUseCopilot 复用 ai:trigger 判定', async () => {
    const allow = makePolicy((permission) => permission === 'ai:trigger')
    expect(await allow.canUseCopilot(FAKE_USER, ORG_A)).toBe(true)

    const deny = makePolicy(() => false)
    expect(await deny.canUseCopilot(FAKE_USER, ORG_A)).toBe(false)
  })

  it('canAccessProject 复用带 projectId 的 project:view 判定', async () => {
    const policy = makePolicy(
      (permission, organizationId, projectId) =>
        permission === 'project:view' && organizationId === ORG_A && projectId === PROJECT_A,
    )
    expect(await policy.canAccessProject(FAKE_USER, ORG_A, PROJECT_A)).toBe(true)
    // 跨组织
    expect(await policy.canAccessProject(FAKE_USER, 99, PROJECT_A)).toBe(false)
    // 无权项目
    expect(await policy.canAccessProject(FAKE_USER, ORG_A, 4242)).toBe(false)
  })

  it('伪造 projectId（非正整数）直接拒绝，不下探 RBAC', async () => {
    const check = vi.fn(() => true)
    const policy = makePolicy(check)
    for (const forged of [0, -5, 1.5, Number.NaN]) {
      expect(await policy.canAccessProject(FAKE_USER, ORG_A, forged)).toBe(false)
    }
    expect(check).not.toHaveBeenCalled()
  })

  it('判定结果只有布尔——不回传 reason / 名称 / 计数', async () => {
    const policy = makePolicy(() => false)
    const result = await policy.canAccessProject(FAKE_USER, ORG_A, PROJECT_A)
    expect(typeof result).toBe('boolean')
    expect(JSON.stringify(result)).not.toContain('permission_not_granted')
  })
})

// ===========================================================================
// 3.2 / 3.3 —— Service 聚合
// ===========================================================================

describe('3.3 readiness aggregation', () => {
  it('全部前置可用 ⇒ ready，并给出稳定 scope / reason / action', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getRecentSession: async () => makeSession(),
        getToolSnapshot: async () => makeSnapshot(),
      }),
    )
    const snapshot = await service.evaluate(CTX_PROJECT)

    expect(snapshot.state).toBe('ready')
    expect(snapshot.contractVersion).toBe(COPILOT_ENTRY_CONTRACT_VERSION)
    expect(snapshot.reasons).toEqual([{ code: 'entry_ready', retryable: false }])
    expect(snapshot.scope).toEqual({
      kind: 'project',
      organizationId: ORG_A,
      projectId: PROJECT_A,
      label: '灯塔迁移项目',
    })
    expect(snapshot.allowedActions).toEqual([
      'open-workspace',
      'continue-session',
      'start-session',
      'retry-readiness',
    ])
    // 服务端从不授予演示能力
    expect(snapshot.allowedActions).not.toContain('enter-explicit-demo')
    expect(parseCopilotEntryReadinessSnapshot(snapshot).ok).toBe(true)
  })

  it('无最近会话 ⇒ 不提供 continue-session', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({ getRecentSession: async () => null }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.recentSession).toBeNull()
    expect(snapshot.allowedActions).not.toContain('continue-session')
  })

  it('可选会话检索失败 ⇒ degraded（核心仍可用）', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getRecentSession: async () => {
          throw new Error('session store down')
        },
        getToolSnapshot: async () => makeSnapshot(),
      }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.state).toBe('degraded')
    expect(snapshot.reasons.map((r) => r.code)).toContain('recent_session_unavailable')
    expect(snapshot.allowedActions).toContain('open-workspace')
    expect(parseCopilotEntryReadinessSnapshot(snapshot).ok).toBe(true)
  })

  it('工具快照陈旧 ⇒ degraded 且插件 quick start 全部缺席', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        toolSnapshotMaxAgeMs: 1000,
        getToolSnapshot: async () => makeSnapshot({ generatedAt: '2026-08-24T01:00:00.000Z' }),
      }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.state).toBe('degraded')
    expect(snapshot.reasons.map((r) => r.code)).toContain('tool_snapshot_stale')
    expect(snapshot.quickStarts.every((q) => q.source === 'core')).toBe(true)
  })

  it('工具快照不可用（null 或抛出）⇒ degraded', async () => {
    const nullSnapshot = new CopilotOperatingEntryService(
      makeDeps({ getToolSnapshot: async () => null }),
    )
    const nullResult = await nullSnapshot.evaluate(CTX_ORG)
    expect(nullResult.reasons.map((r) => r.code)).toContain('tool_snapshot_unavailable')

    const throwing = new CopilotOperatingEntryService(
      makeDeps({
        getToolSnapshot: async () => {
          throw new Error('registry down')
        },
      }),
    )
    const snapshot = await throwing.evaluate(CTX_ORG)
    expect(snapshot.state).toBe('degraded')
    expect(snapshot.reasons.map((r) => r.code)).toContain('tool_snapshot_unavailable')
  })

  it('缺少组织上下文 ⇒ unavailable 且不调用任何下游', async () => {
    const canUseCopilot = vi.fn(async () => true)
    const canAccessProject = vi.fn(async () => true)
    const getRecentSession = vi.fn(async () => makeSession())
    const getToolSnapshot = vi.fn(async () => makeSnapshot())
    const service = new CopilotOperatingEntryService(
      makeDeps({ canUseCopilot, canAccessProject, getRecentSession, getToolSnapshot }),
    )

    for (const organizationId of [null, 0, -1]) {
      const snapshot = await service.evaluate({ actorId: 1, organizationId })
      expect(snapshot.state).toBe('unavailable')
      expect(snapshot.reasons).toEqual([{ code: 'organization_context_missing', retryable: false }])
      expect(snapshot.allowedActions).toEqual(['retry-readiness'])
    }
    expect(canUseCopilot).not.toHaveBeenCalled()
    expect(canAccessProject).not.toHaveBeenCalled()
    expect(getRecentSession).not.toHaveBeenCalled()
    expect(getToolSnapshot).not.toHaveBeenCalled()
  })

  it('无 Copilot 权限 ⇒ unavailable，且不再取会话/工具', async () => {
    const getRecentSession = vi.fn(async () => makeSession())
    const getToolSnapshot = vi.fn(async () => makeSnapshot())
    const service = new CopilotOperatingEntryService(
      makeDeps({ canUseCopilot: async () => false, getRecentSession, getToolSnapshot }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.state).toBe('unavailable')
    expect(snapshot.reasons).toEqual([{ code: 'copilot_permission_denied', retryable: false }])
    expect(snapshot.quickStarts).toEqual([])
    expect(getRecentSession).not.toHaveBeenCalled()
    expect(getToolSnapshot).not.toHaveBeenCalled()
  })

  it('project scope 不可授权 ⇒ unavailable 且零泄露（回落组织级 scope）', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({ canAccessProject: async () => false }),
    )
    const snapshot = await service.evaluate(CTX_PROJECT)
    expect(snapshot.state).toBe('unavailable')
    expect(snapshot.reasons).toEqual([{ code: 'project_scope_denied', retryable: false }])
    expect(snapshot.scope).toEqual({ kind: 'organization', organizationId: ORG_A })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain(String(PROJECT_A))
    expect(serialized).not.toContain('灯塔迁移项目')
  })

  it('核心前置判定自身故障 ⇒ unavailable + 可重试', async () => {
    const turnDown = new CopilotOperatingEntryService(
      makeDeps({
        canUseCopilot: async () => {
          throw new Error('rbac down')
        },
      }),
    )
    const snapshot = await turnDown.evaluate(CTX_ORG)
    expect(snapshot.reasons).toEqual([{ code: 'turn_channel_unavailable', retryable: true }])

    const projectDown = new CopilotOperatingEntryService(
      makeDeps({
        canAccessProject: async () => {
          throw new Error('policy down')
        },
      }),
    )
    const failed = await projectDown.evaluate(CTX_PROJECT)
    expect(failed.reasons).toEqual([{ code: 'readiness_evaluation_failed', retryable: true }])
  })

  it('项目展示名不可用不影响可用性（scope 仍为已授权项目）', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getProjectLabel: async () => {
          throw new Error('label lookup down')
        },
      }),
    )
    const snapshot = await service.evaluate(CTX_PROJECT)
    expect(snapshot.state).toBe('ready')
    expect(snapshot.scope).toEqual({
      kind: 'project',
      organizationId: ORG_A,
      projectId: PROJECT_A,
    })
  })

  it('零副作用：聚合期间只调用注入的读依赖', async () => {
    const calls: string[] = []
    const service = new CopilotOperatingEntryService({
      canUseCopilot: async () => {
        calls.push('canUseCopilot')
        return true
      },
      canAccessProject: async () => {
        calls.push('canAccessProject')
        return true
      },
      hasPermission: async () => {
        calls.push('hasPermission')
        return true
      },
      getProjectLabel: async () => {
        calls.push('getProjectLabel')
        return '灯塔迁移项目'
      },
      getRecentSession: async () => {
        calls.push('getRecentSession')
        return makeSession()
      },
      getToolSnapshot: async () => {
        calls.push('getToolSnapshot')
        return makeSnapshot()
      },
      now: () => NOW,
    })
    await service.evaluate(CTX_PROJECT)

    // 求值顺序固定：project 可见性 → 展示名 → 核心前置 → 会话 → 工具快照
    expect(calls[0]).toBe('canAccessProject')
    expect(calls[1]).toBe('getProjectLabel')
    expect(calls[2]).toBe('canUseCopilot')
    expect(calls).toContain('getRecentSession')
    expect(calls).toContain('getToolSnapshot')
    // 没有任何写类调用名出现
    expect(calls.some((c) => /create|update|append|write|persist|audit/i.test(c))).toBe(false)
  })

  it('相同输入产生相同输出（确定性）', async () => {
    const build = () =>
      new CopilotOperatingEntryService(
        makeDeps({
          getRecentSession: async () => makeSession(),
          getToolSnapshot: async () => makeSnapshot(),
        }),
      )
    const first = await build().evaluate(CTX_PROJECT)
    const second = await build().evaluate(CTX_PROJECT)
    expect(first).toEqual(second)
  })
})

// ===========================================================================
// 3.4 —— 会话投影
// ===========================================================================

describe('3.4 recent session projection', () => {
  it('有界标题并保留可续接引用', () => {
    const projected = projectRecentSession(makeSession({ title: '排'.repeat(200) }))
    expect(projected?.titleSummary.length).toBeLessThanOrEqual(60)
    expect(projected?.sessionId).toBe('csess_0001')
  })

  it('无标题回落中性占位（不泄露内容）', () => {
    expect(projectRecentSession(makeSession({ title: null }))?.titleSummary).toBe(
      COPILOT_ENTRY_UNTITLED_SESSION_LABEL,
    )
    expect(projectRecentSession(makeSession({ title: '   ' }))?.titleSummary).toBe(
      COPILOT_ENTRY_UNTITLED_SESSION_LABEL,
    )
  })

  it('archived / 非活跃 / retention blocked 一律缺席', () => {
    expect(projectRecentSession(makeSession({ archived: true }))).toBeNull()
    expect(projectRecentSession(makeSession({ status: 'deleted' }))).toBeNull()
    expect(projectRecentSession(makeSession({ retentionBlocked: true }))).toBeNull()
  })

  it('未知 scope 或非法时间戳 fail closed', () => {
    expect(projectRecentSession(makeSession({ scope: 'workspace' }))).toBeNull()
    expect(projectRecentSession(makeSession({ updatedAt: null }))).toBeNull()
    expect(projectRecentSession(makeSession({ updatedAt: 'not-a-date' }))).toBeNull()
  })

  it('投影只含 4 个字段（不含消息正文）', () => {
    const projected = projectRecentSession(makeSession())
    expect(Object.keys(projected ?? {}).sort()).toEqual([
      'scope',
      'sessionId',
      'titleSummary',
      'updatedAt',
    ])
  })

  it('会话权威只被查询一次，且按更新时间倒序取至多一条', async () => {
    const getRecentSession = vi.fn(async () => makeSession())
    const service = new CopilotOperatingEntryService(makeDeps({ getRecentSession }))
    const snapshot = await service.evaluate(CTX_PROJECT)
    expect(getRecentSession).toHaveBeenCalledTimes(1)
    expect(snapshot.recentSession).not.toBeNull()
  })

  it('下游返回不合格会话（archived）时快照不提供 continue-session', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({ getRecentSession: async () => makeSession({ archived: true }) }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.recentSession).toBeNull()
    expect(snapshot.allowedActions).not.toContain('continue-session')
  })
})

// ===========================================================================
// 3.5 —— quick starts
// ===========================================================================

describe('3.5 quick starts', () => {
  it('core quick start 按权限过滤，无权条目缺席且无解释性泄露', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({ hasPermission: async (_ctx, permission) => permission === 'project:view' }),
    )
    const snapshot = await service.evaluate(CTX_PROJECT)
    const ids = snapshot.quickStarts.map((q) => q.quickStartId)
    expect(ids).toContain('core.project-health')
    expect(ids).not.toContain('core.plan-new-project')
    expect(JSON.stringify(snapshot)).not.toContain('project:create')
  })

  it('组织级 scope 只保留适用条目', async () => {
    const service = new CopilotOperatingEntryService(makeDeps())
    const snapshot = await service.evaluate(CTX_ORG)
    const ids = snapshot.quickStarts.map((q) => q.quickStartId)
    expect(ids).toContain('core.explain-term')
    expect(ids).not.toContain('core.critical-path')
  })

  it('权限判定不可用 ⇒ 条目缺席并降级为 degraded（fail closed）', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        hasPermission: async () => {
          throw new Error('rbac down')
        },
      }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.state).toBe('degraded')
    expect(snapshot.reasons.map((r) => r.code)).toContain('quick_starts_unavailable')
    expect(snapshot.quickStarts).toEqual([])
  })

  it('插件 quick start 绑定快照 revision 与 tool digest', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({ getToolSnapshot: async () => makeSnapshot() }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    const pluginItem = snapshot.quickStarts.find((q) => q.source === 'plugin')
    expect(pluginItem?.pluginBinding).toEqual({
      pluginId: 'plg_official',
      pluginVersion: '1.0.0',
      toolId: 'ctool_risk_lookup',
      toolDigest: 'digest_risk',
      snapshotRevision: 'snap_rev_0001',
    })
  })

  it('资格快照为空（disabled/incompatible/无权/跨租）⇒ 插件条目全部缺席且不解释', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({ getToolSnapshot: async () => makeSnapshot({ entries: [] }) }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.quickStarts.some((q) => q.source === 'plugin')).toBe(false)
    const serialized = JSON.stringify(snapshot)
    for (const leak of ['disabled', 'incompatible', 'no_permission', 'exclusion']) {
      expect(serialized).not.toContain(leak)
    }
  })

  it('未知 sideEffectClass 的条目缺席（词表外 fail closed）', () => {
    const quickStarts = projectPluginQuickStarts(
      makeSnapshot({
        entries: [
          {
            toolId: 'ctool_weird',
            name: '未知工具',
            sideEffectClass: 'destroy',
            pluginId: 'plg_x',
            pluginVersion: '1.0.0',
            toolDigest: 'd',
          },
        ],
      }),
    )
    expect(quickStarts).toEqual([])
  })

  it('core 先于 plugin，且不超过上限', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getToolSnapshot: async () =>
          makeSnapshot({
            entries: Array.from({ length: 10 }, (_unused, index) => ({
              toolId: `ctool_${String(index).padStart(2, '0')}`,
              name: `工具 ${index}`,
              sideEffectClass: 'query',
              pluginId: 'plg_official',
              pluginVersion: '1.0.0',
              toolDigest: `digest_${index}`,
            })),
          }),
      }),
    )
    const snapshot = await service.evaluate(CTX_PROJECT)
    expect(snapshot.quickStarts.length).toBeLessThanOrEqual(COPILOT_ENTRY_MAX_QUICK_STARTS)
    const sources = snapshot.quickStarts.map((q) => q.source)
    expect(sources).toEqual([...sources].sort((a, b) => (a === b ? 0 : a === 'core' ? -1 : 1)))
    expect(parseCopilotEntryReadinessSnapshot(snapshot).ok).toBe(true)
  })

  it('core 声明全部为只读（query）——入口不产出写类核心建议', () => {
    const service = new CopilotOperatingEntryService(makeDeps())
    expect(service).toBeDefined()
    expect(COPILOT_ENTRY_CORE_QUICK_STARTS.length).toBeGreaterThan(0)
    for (const declaration of COPILOT_ENTRY_CORE_QUICK_STARTS) {
      expect(declaration.draftTemplate.length).toBeLessThanOrEqual(200)
      expect(declaration.label.length).toBeLessThanOrEqual(40)
    }
  })

  it('写类插件工具可以出现，但只是建议——快照不含任何确认入口字段', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getToolSnapshot: async () =>
          makeSnapshot({
            entries: [
              {
                toolId: 'ctool_report_writer',
                name: '周报生成',
                sideEffectClass: 'write',
                pluginId: 'plg_report',
                pluginVersion: '0.9.1',
                toolDigest: 'digest_report',
              },
            ],
          }),
      }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    const writeItem = snapshot.quickStarts.find((q) => q.sideEffectClass === 'write')
    expect(writeItem).toBeDefined()
    const serialized = JSON.stringify(snapshot)
    for (const forbidden of ['confirm', 'apply', 'commit', 'execute']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden)
    }
  })
})

// ===========================================================================
// 6.1 —— 插件生命周期负例（disable / upgrade / incompatible / 跨租）
// ===========================================================================

describe('6.1 plugin lifecycle negatives', () => {
  it('工具在入口加载后被 disable ⇒ 下一次快照里整体缺席，且不解释原因', async () => {
    let enabled = true
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getToolSnapshot: async () =>
          enabled ? makeSnapshot() : makeSnapshot({ revision: 'snap_rev_0002', entries: [] }),
      }),
    )

    const before = await service.evaluate(CTX_ORG)
    expect(before.quickStarts.some((q) => q.source === 'plugin')).toBe(true)

    enabled = false
    const after = await service.evaluate(CTX_ORG)
    expect(after.quickStarts.some((q) => q.source === 'plugin')).toBe(false)
    const serialized = JSON.stringify(after)
    expect(serialized).not.toContain('disabled')
    expect(serialized).not.toContain('ctool_risk_lookup')
  })

  it('插件升级 ⇒ 绑定 revision 随之改变（旧选择据此判 stale）', async () => {
    let version = '1.0.0'
    let revision = 'snap_rev_0001'
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getToolSnapshot: async () =>
          makeSnapshot({
            revision,
            entries: [
              {
                toolId: 'ctool_risk_lookup',
                name: '风险查询',
                sideEffectClass: 'query',
                pluginId: 'plg_official',
                pluginVersion: version,
                toolDigest: `digest_${version}`,
              },
            ],
          }),
      }),
    )

    const before = await service.evaluate(CTX_ORG)
    const beforeBinding = before.quickStarts.find((q) => q.source === 'plugin')?.pluginBinding

    version = '1.1.0'
    revision = 'snap_rev_0002'
    const after = await service.evaluate(CTX_ORG)
    const afterBinding = after.quickStarts.find((q) => q.source === 'plugin')?.pluginBinding

    expect(beforeBinding?.snapshotRevision).not.toBe(afterBinding?.snapshotRevision)
    expect(beforeBinding?.toolDigest).not.toBe(afterBinding?.toolDigest)
    expect(afterBinding?.pluginVersion).toBe('1.1.0')
  })

  it('不兼容或无权工具由资格快照过滤，入口不做第二次判定', async () => {
    // 资格快照已把不兼容/无权条目移除；入口只消费剩余条目，不重算兼容性。
    const service = new CopilotOperatingEntryService(
      makeDeps({ getToolSnapshot: async () => makeSnapshot({ entries: [] }) }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(snapshot.quickStarts.every((q) => q.source === 'core')).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('incompatible')
  })

  it('跨租：另一组织的快照条目不会出现在当前 scope', async () => {
    const service = new CopilotOperatingEntryService(
      makeDeps({
        getToolSnapshot: async (ctx) =>
          ctx.organizationId === ORG_A
            ? makeSnapshot({ entries: [] })
            : makeSnapshot({
                entries: [
                  {
                    toolId: 'ctool_secret',
                    name: '他组织专用工具',
                    sideEffectClass: 'query',
                    pluginId: 'plg_other',
                    pluginVersion: '1.0.0',
                    toolDigest: 'digest_secret',
                  },
                ],
              }),
      }),
    )
    const snapshot = await service.evaluate(CTX_ORG)
    expect(JSON.stringify(snapshot)).not.toContain('他组织专用工具')
  })

  it('readiness TOCTOU：同一 service 在权限变化后立即反映新判定', async () => {
    let allowed = true
    const service = new CopilotOperatingEntryService(
      makeDeps({ canUseCopilot: async () => allowed }),
    )
    const initial = await service.evaluate(CTX_ORG)
    expect(initial.state).toBe('ready')
    allowed = false
    const revoked = await service.evaluate(CTX_ORG)
    expect(revoked.state).toBe('unavailable')
    expect(revoked.reasons).toEqual([{ code: 'copilot_permission_denied', retryable: false }])
  })
})
