// packages/types/src/copilot-productized-operating-entry.test.ts
// v3-copilot-productized-operating-entry —— 入口/就绪契约与错误分类契约测试（任务 2.2 / 2.4）

import { describe, it, expect } from 'vitest'

import {
  COPILOT_ENTRY_ALLOWED_ACTIONS,
  COPILOT_ENTRY_CONTRACT_VERSION,
  COPILOT_ENTRY_FAILURE_KINDS,
  COPILOT_ENTRY_MAX_QUICK_STARTS,
  COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH,
  COPILOT_ENTRY_REASON_CODES,
  boundCopilotEntryQuickStarts,
  boundCopilotEntryText,
  canEnterCopilotDemonstration,
  classifyCopilotEntryFailure,
  copilotEntryFailureOutcome,
  detectCopilotEntryForbiddenFields,
  isCopilotEntryFailureKind,
  parseCopilotEntryReadinessSnapshot,
  sortCopilotEntryQuickStarts,
} from './copilot-productized-operating-entry.js'
import type { CopilotEntryQuickStart } from './copilot-productized-operating-entry.js'

import {
  ENTRY_FIXTURE_API_ERRORS,
  ENTRY_FIXTURE_CORE_QUICK_START,
  ENTRY_FIXTURE_CORE_QUICK_START_B,
  ENTRY_FIXTURE_PLUGIN_QUICK_START,
  ENTRY_FIXTURE_WRITE_QUICK_START,
  degradedEntrySnapshotFixture,
  entrySnapshotWithExclusionsFixture,
  entrySnapshotWithForbiddenFieldFixture,
  entrySnapshotWithInconsistentReasonFixture,
  entrySnapshotWithOverlongTitleFixture,
  entrySnapshotWithTooManyQuickStartsFixture,
  entrySnapshotWithUnboundPluginQuickStartFixture,
  entrySnapshotWithUnknownEnumFixture,
  entrySnapshotWithUnknownFieldFixture,
  readyEmptyEntrySnapshotFixture,
  readyEntrySnapshotFixture,
  unavailableEntrySnapshotFixture,
  unavailableNoOrganizationFixture,
} from './copilot-productized-operating-entry-fixtures.js'

// ---------------------------------------------------------------------------
// 三态解析：ready / degraded / unavailable
// ---------------------------------------------------------------------------

describe('readiness snapshot parsing — three closed states', () => {
  it('接受 ready 快照并保留 scope、动作与 quick starts', () => {
    const result = parseCopilotEntryReadinessSnapshot(readyEntrySnapshotFixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.state).toBe('ready')
    expect(result.snapshot.contractVersion).toBe(COPILOT_ENTRY_CONTRACT_VERSION)
    expect(result.snapshot.scope).toEqual({
      kind: 'project',
      organizationId: 7,
      projectId: 42,
      label: '灯塔迁移项目',
    })
    expect(result.snapshot.reasons).toEqual([{ code: 'entry_ready', retryable: false }])
    expect(result.snapshot.quickStarts).toHaveLength(2)
    expect(result.snapshot.recentSession?.sessionId).toBe('csess_fixture_recent_0001')
  })

  it('接受 ready + 空可选内容（empty 态）', () => {
    const result = parseCopilotEntryReadinessSnapshot(readyEmptyEntrySnapshotFixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.recentSession).toBeNull()
    expect(result.snapshot.quickStarts).toEqual([])
    expect(result.snapshot.allowedActions).not.toContain('continue-session')
  })

  it('接受 degraded 快照：可选能力原因码 + 仅保留安全动作', () => {
    const result = parseCopilotEntryReadinessSnapshot(degradedEntrySnapshotFixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.state).toBe('degraded')
    expect(result.snapshot.reasons.map((r) => r.code)).toEqual([
      'recent_session_unavailable',
      'tool_snapshot_stale',
    ])
    expect(result.snapshot.allowedActions).not.toContain('continue-session')
    expect(result.snapshot.recentSession).toBeNull()
  })

  it('接受 unavailable 快照且不暴露被拒 scope 的任何标识', () => {
    const result = parseCopilotEntryReadinessSnapshot(unavailableEntrySnapshotFixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.state).toBe('unavailable')
    expect(result.snapshot.scope.projectId).toBeUndefined()
    expect(result.snapshot.scope.label).toBeUndefined()
    expect(result.snapshot.allowedActions).toEqual(['retry-readiness'])
    expect(JSON.stringify(result.snapshot)).not.toContain('42')
  })

  it('接受 unavailable：无有效组织上下文', () => {
    const result = parseCopilotEntryReadinessSnapshot(unavailableNoOrganizationFixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.reasons[0]?.code).toBe('organization_context_missing')
  })
})

// ---------------------------------------------------------------------------
// fail closed：未知字段 / 未知枚举 / 越界 / 不变量
// ---------------------------------------------------------------------------

describe('readiness snapshot parsing — fail closed', () => {
  it('未知字段一律拒绝，不静默丢弃', () => {
    const result = parseCopilotEntryReadinessSnapshot(entrySnapshotWithUnknownFieldFixture)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-unknown-field')).toBe(true)
  })

  it('未知枚举值一律拒绝', () => {
    const result = parseCopilotEntryReadinessSnapshot(entrySnapshotWithUnknownEnumFixture)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-unknown-enum')).toBe(true)
  })

  it('非对象输入拒绝', () => {
    for (const bad of [null, undefined, 42, 'ready', [readyEntrySnapshotFixture]]) {
      expect(parseCopilotEntryReadinessSnapshot(bad).ok).toBe(false)
    }
  })

  it('契约版本不匹配时拒绝', () => {
    const result = parseCopilotEntryReadinessSnapshot({
      ...readyEntrySnapshotFixture,
      contractVersion: '0.9.0',
    })
    expect(result.ok).toBe(false)
  })

  it('recentSession 必须显式提供（缺省不等于 null）', () => {
    const { recentSession: _omitted, ...withoutSession } = readyEntrySnapshotFixture
    const result = parseCopilotEntryReadinessSnapshot(withoutSession)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.path === 'recentSession')).toBe(true)
  })

  it('会话标题超界拒绝（有界摘要）', () => {
    const result = parseCopilotEntryReadinessSnapshot(entrySnapshotWithOverlongTitleFixture)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-bound-exceeded')).toBe(true)
  })

  it('quick start 数量超上限拒绝', () => {
    const result = parseCopilotEntryReadinessSnapshot(entrySnapshotWithTooManyQuickStartsFixture)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-bound-exceeded')).toBe(true)
  })

  it('插件来源 quick start 缺少快照绑定时拒绝', () => {
    const result = parseCopilotEntryReadinessSnapshot(
      entrySnapshotWithUnboundPluginQuickStartFixture,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-invariant-violated')).toBe(true)
  })

  it('core 来源携带插件绑定时拒绝', () => {
    const result = parseCopilotEntryReadinessSnapshot({
      ...readyEntrySnapshotFixture,
      quickStarts: [
        {
          ...ENTRY_FIXTURE_CORE_QUICK_START,
          pluginBinding: ENTRY_FIXTURE_PLUGIN_QUICK_START.pluginBinding,
        },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('状态与原因码不一致时拒绝（ready 携带降级原因）', () => {
    const result = parseCopilotEntryReadinessSnapshot(entrySnapshotWithInconsistentReasonFixture)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-invariant-violated')).toBe(true)
  })

  it('degraded 携带 mandatory 原因码时拒绝', () => {
    const result = parseCopilotEntryReadinessSnapshot({
      ...degradedEntrySnapshotFixture,
      reasons: [{ code: 'copilot_permission_denied', retryable: false }],
    })
    expect(result.ok).toBe(false)
  })

  it('项目级 scope 缺 projectId / 组织级 scope 带 projectId 都拒绝', () => {
    expect(
      parseCopilotEntryReadinessSnapshot({
        ...readyEntrySnapshotFixture,
        scope: { kind: 'project', organizationId: 7 },
      }).ok,
    ).toBe(false)
    expect(
      parseCopilotEntryReadinessSnapshot({
        ...readyEmptyEntrySnapshotFixture,
        scope: { kind: 'organization', organizationId: 7, projectId: 42 },
      }).ok,
    ).toBe(false)
  })

  it('重复 quickStartId 与重复动作都拒绝', () => {
    expect(
      parseCopilotEntryReadinessSnapshot({
        ...readyEntrySnapshotFixture,
        quickStarts: [ENTRY_FIXTURE_CORE_QUICK_START, ENTRY_FIXTURE_CORE_QUICK_START],
      }).ok,
    ).toBe(false)
    expect(
      parseCopilotEntryReadinessSnapshot({
        ...readyEntrySnapshotFixture,
        allowedActions: ['open-workspace', 'open-workspace'],
      }).ok,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 禁存样本
// ---------------------------------------------------------------------------

describe('forbidden-field detection', () => {
  it('检出 prompt 全文并拒绝解析', () => {
    expect(detectCopilotEntryForbiddenFields(entrySnapshotWithForbiddenFieldFixture)).toContain(
      'prompt',
    )
    const result = parseCopilotEntryReadinessSnapshot(entrySnapshotWithForbiddenFieldFixture)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.code === 'entry-forbidden-field')).toBe(true)
  })

  it('检出资格快照 exclusions（无权工具存在性泄露）', () => {
    expect(detectCopilotEntryForbiddenFields(entrySnapshotWithExclusionsFixture)).toContain(
      'exclusions',
    )
    expect(parseCopilotEntryReadinessSnapshot(entrySnapshotWithExclusionsFixture).ok).toBe(false)
  })

  it('检出嵌套路径上的禁存字段', () => {
    const hits = detectCopilotEntryForbiddenFields({
      quickStarts: [{ quickStartId: 'a', pluginBinding: { toolResult: 'x' } }],
    })
    expect(hits).toEqual(['quickStarts[0].pluginBinding.toolResult'])
  })

  it('合法 fixture 无禁存命中', () => {
    expect(detectCopilotEntryForbiddenFields(readyEntrySnapshotFixture)).toEqual([])
    expect(detectCopilotEntryForbiddenFields(degradedEntrySnapshotFixture)).toEqual([])
    expect(detectCopilotEntryForbiddenFields(unavailableEntrySnapshotFixture)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 确定性排序与上限
// ---------------------------------------------------------------------------

describe('quick start ordering and bounds', () => {
  it('core 优先于 plugin，同来源按 quickStartId 升序', () => {
    const sorted = sortCopilotEntryQuickStarts([
      ENTRY_FIXTURE_WRITE_QUICK_START,
      ENTRY_FIXTURE_CORE_QUICK_START,
      ENTRY_FIXTURE_PLUGIN_QUICK_START,
      ENTRY_FIXTURE_CORE_QUICK_START_B,
    ])
    expect(sorted.map((q) => q.quickStartId)).toEqual([
      'core.ask-anything',
      'core.project-health',
      'plugin.report.weekly',
      'plugin.triz.contradiction',
    ])
  })

  it('排序是纯函数：不改动入参且同输入同输出', () => {
    const input = [ENTRY_FIXTURE_PLUGIN_QUICK_START, ENTRY_FIXTURE_CORE_QUICK_START]
    const snapshotBefore = JSON.stringify(input)
    const first = sortCopilotEntryQuickStarts(input)
    const second = sortCopilotEntryQuickStarts(input)
    expect(JSON.stringify(input)).toBe(snapshotBefore)
    expect(first).toEqual(second)
  })

  it('按上限确定性截断，且截断结果仍是排序前缀', () => {
    const many: CopilotEntryQuickStart[] = Array.from({ length: 12 }, (_unused, index) => ({
      quickStartId: `core.item-${String(index).padStart(2, '0')}`,
      source: 'core',
      label: `建议 ${index}`,
      draftTemplate: `示例 ${index}`,
      sideEffectClass: 'query',
    }))
    const bounded = boundCopilotEntryQuickStarts(many)
    expect(bounded).toHaveLength(COPILOT_ENTRY_MAX_QUICK_STARTS)
    expect(bounded.map((q) => q.quickStartId)).toEqual(
      sortCopilotEntryQuickStarts(many)
        .slice(0, COPILOT_ENTRY_MAX_QUICK_STARTS)
        .map((q) => q.quickStartId),
    )
  })

  it('非法上限回退到默认上限', () => {
    const many: CopilotEntryQuickStart[] = Array.from({ length: 8 }, (_unused, index) => ({
      quickStartId: `core.item-${index}`,
      source: 'core',
      label: 'x',
      draftTemplate: 'y',
      sideEffectClass: 'query',
    }))
    expect(boundCopilotEntryQuickStarts(many, Number.NaN)).toHaveLength(
      COPILOT_ENTRY_MAX_QUICK_STARTS,
    )
    expect(boundCopilotEntryQuickStarts(many, -3)).toHaveLength(COPILOT_ENTRY_MAX_QUICK_STARTS)
  })

  it('boundCopilotEntryText 折叠空白并保证长度上界', () => {
    expect(boundCopilotEntryText('  排期   冲突  ', 20)).toBe('排期 冲突')
    const truncated = boundCopilotEntryText(
      '排'.repeat(200),
      COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH,
    )
    expect(truncated.length).toBe(COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH)
    expect(truncated.endsWith('…')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 错误分类矩阵（任务 2.4）
// ---------------------------------------------------------------------------

describe('production failure classification', () => {
  const matrix: readonly [unknown, string][] = [
    [ENTRY_FIXTURE_API_ERRORS.auth, 'auth'],
    [ENTRY_FIXTURE_API_ERRORS.roleVersion, 'auth'],
    [ENTRY_FIXTURE_API_ERRORS.permission, 'permission'],
    [ENTRY_FIXTURE_API_ERRORS.notFound, 'permission'],
    [ENTRY_FIXTURE_API_ERRORS.validation, 'validation'],
    [ENTRY_FIXTURE_API_ERRORS.rateLimit, 'rate-limit'],
    [ENTRY_FIXTURE_API_ERRORS.conflict, 'conflict'],
    [ENTRY_FIXTURE_API_ERRORS.stale, 'stale'],
    [ENTRY_FIXTURE_API_ERRORS.service, 'retryable-service'],
    [ENTRY_FIXTURE_API_ERRORS.tenant, 'retryable-service'],
  ]

  it.each(matrix)('把 %o 归类为稳定类别', (error, expectedKind) => {
    expect(classifyCopilotEntryFailure(error).kind).toBe(expectedKind)
  })

  it('错误码优先于 HTTP 状态（stale 用 409 承载但不归 conflict）', () => {
    expect(classifyCopilotEntryFailure(ENTRY_FIXTURE_API_ERRORS.stale).kind).toBe('stale')
    expect(classifyCopilotEntryFailure({ status: 409 }).kind).toBe('conflict')
  })

  it('未知错误码回落到 HTTP 状态', () => {
    expect(classifyCopilotEntryFailure({ status: 500, code: 'BRAND_NEW' }).kind).toBe(
      'retryable-service',
    )
  })

  it('完全未知的错误默认 live failure（unknown），不是成功也不是演示', () => {
    for (const unknownError of [
      ENTRY_FIXTURE_API_ERRORS.transport,
      ENTRY_FIXTURE_API_ERRORS.unknownCode,
      null,
      undefined,
      'boom',
      {},
    ]) {
      const outcome = classifyCopilotEntryFailure(unknownError)
      expect(outcome.kind).toBe('unknown')
      expect(outcome.allowsDemonstration).toBe(false)
    }
  })

  it('任何生产错误都不产生 demonstration success', () => {
    const allErrors = [...Object.values(ENTRY_FIXTURE_API_ERRORS), null, undefined, 0, 'x', {}]
    for (const error of allErrors) {
      const outcome = classifyCopilotEntryFailure(error)
      expect(outcome.allowsDemonstration).toBe(false)
      expect(outcome.preserveDraft).toBe(true)
    }
    for (const kind of COPILOT_ENTRY_FAILURE_KINDS) {
      expect(copilotEntryFailureOutcome(kind).allowsDemonstration).toBe(false)
    }
  })

  it('权限/校验/冲突/stale 不允许无脑重试；auth/限流/服务/未知允许重试', () => {
    expect(copilotEntryFailureOutcome('permission').retryable).toBe(false)
    expect(copilotEntryFailureOutcome('validation').retryable).toBe(false)
    expect(copilotEntryFailureOutcome('conflict').retryable).toBe(false)
    expect(copilotEntryFailureOutcome('stale').retryable).toBe(false)
    expect(copilotEntryFailureOutcome('auth').retryable).toBe(true)
    expect(copilotEntryFailureOutcome('rate-limit').retryable).toBe(true)
    expect(copilotEntryFailureOutcome('retryable-service').retryable).toBe(true)
    expect(copilotEntryFailureOutcome('unknown').retryable).toBe(true)
  })

  it('权限/stale/冲突/auth 触发 readiness 重新求值；auth 额外要求重新认证', () => {
    expect(copilotEntryFailureOutcome('permission').refreshReadiness).toBe(true)
    expect(copilotEntryFailureOutcome('stale').refreshReadiness).toBe(true)
    expect(copilotEntryFailureOutcome('conflict').refreshReadiness).toBe(true)
    expect(copilotEntryFailureOutcome('auth').requiresReauth).toBe(true)
    expect(copilotEntryFailureOutcome('permission').requiresReauth).toBe(false)
  })

  it('分类结果不透传后端 message 或状态码', () => {
    const outcome = classifyCopilotEntryFailure(ENTRY_FIXTURE_API_ERRORS.permission)
    const serialized = JSON.stringify(outcome)
    expect(serialized).not.toContain('权限不足')
    expect(serialized).not.toContain('403')
  })
})

// ---------------------------------------------------------------------------
// 演示态准入
// ---------------------------------------------------------------------------

describe('explicit demonstration gate', () => {
  it('必须宿主声明且用户选择才可进入', () => {
    expect(canEnterCopilotDemonstration({ capabilityDeclared: true, userSelected: true })).toBe(
      true,
    )
    expect(canEnterCopilotDemonstration({ capabilityDeclared: true, userSelected: false })).toBe(
      false,
    )
    expect(canEnterCopilotDemonstration({ capabilityDeclared: false, userSelected: true })).toBe(
      false,
    )
    expect(canEnterCopilotDemonstration({ capabilityDeclared: false, userSelected: false })).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// 词表守卫
// ---------------------------------------------------------------------------

describe('closed vocabularies', () => {
  it('原因码、动作与失败类别都是封闭词表', () => {
    expect(COPILOT_ENTRY_REASON_CODES).toContain('entry_ready')
    expect(COPILOT_ENTRY_ALLOWED_ACTIONS).toContain('enter-explicit-demo')
    expect(isCopilotEntryFailureKind('permission')).toBe(true)
    expect(isCopilotEntryFailureKind('teapot')).toBe(false)
  })
})
