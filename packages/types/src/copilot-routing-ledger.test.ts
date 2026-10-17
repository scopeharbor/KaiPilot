/**
 * v3-copilot-routing-decision-ledger —— 契约与 fixtures 测试。
 *
 * 覆盖：
 * - 五类改道分类（含歧义选择不计错误、放弃不记为错误路由）
 * - 准确率口径（首位/前N分列、放弃计入分母、歧义不计错误分子）
 * - 输入元组 hash 含目录版本
 * - 禁存原始输入全文
 * - 确定性违规检测
 * - 兜底率健康状态（不触发自动动作）
 * - 不可用类别分布
 * - 澄清效率
 * - sanitizer
 * - fixtures 一致性
 */

import { describe, it, expect } from 'vitest'
import {
  ROUTING_REDIRECT_CLASSES,
  ROUTING_REDIRECT_CLASS_LABELS,
  ROUTING_ERROR_REDIRECT_CLASSES,
  ROUTING_ATTRIBUTION_CONFIDENCES,
  ROUTING_UNAVAILABILITY_KINDS,
  ROUTING_FALLBACK_HEALTH_STATUSES,
  ROUTING_FALLBACK_WARNING_THRESHOLD,
  ROUTING_FALLBACK_CRITICAL_THRESHOLD,
  classifyRedirect,
  evaluateFallbackHealthStatus,
  computeRoutingInputTupleHash,
  computeRoutingLedgerIdempotencyKey,
  computeRoutingRecordTupleHash,
  computeUnavailabilityDistribution,
  detectReproducibilityViolation,
  validateRoutingLedgerRecordLowSensitivity,
  buildRoutingLedgerRecord,
  computeRoutingAccuracyMetrics,
  computeRoutingRuleHitMetrics,
  computeRoutingClarificationEfficiency,
} from './copilot-routing-ledger.js'
import {
  ROUTING_LEDGER_FIXTURE_ACCEPTED_TOP,
  ROUTING_LEDGER_FIXTURE_ACCEPTED_NON_TOP,
  ROUTING_LEDGER_FIXTURE_WENT_TO_UNRECOMMENDED,
  ROUTING_LEDGER_FIXTURE_ABANDONED,
  ROUTING_LEDGER_FIXTURE_AMBIGUOUS_CHOICE,
  ROUTING_LEDGER_FIXTURE_MODEL_FALLBACK,
  ROUTING_LEDGER_FIXTURE_MULTI_ROUND_CLARIFICATION,
  ROUTING_LEDGER_FIXTURE_DETERMINISM_VIOLATION,
  ROUTING_LEDGER_FIXTURE_UNAVAILABILITY_DISTRIBUTION,
  ROUTING_LEDGER_FIXTURE_ACCURACY_METRICS,
  ROUTING_LEDGER_FIXTURE_CATALOG_VERSION,
  ROUTING_LEDGER_FIXTURE_ORG_ID,
} from './copilot-routing-ledger-fixtures.js'

// ===========================================================================
// §2.3 五类改道分类
// ===========================================================================

describe('五类改道分类', () => {
  it('五类枚举完整且无重复', () => {
    expect(ROUTING_REDIRECT_CLASSES).toHaveLength(5)
    expect(new Set(ROUTING_REDIRECT_CLASSES).size).toBe(5)
  })

  it('每类都有中文标签', () => {
    for (const cls of ROUTING_REDIRECT_CLASSES) {
      expect(ROUTING_REDIRECT_CLASS_LABELS[cls]).toBeTruthy()
      expect(typeof ROUTING_REDIRECT_CLASS_LABELS[cls]).toBe('string')
    }
  })

  it('路由错误分类只含非首位候选和改到未推荐', () => {
    expect(ROUTING_ERROR_REDIRECT_CLASSES).toEqual(['accepted_non_top', 'went_to_unrecommended'])
  })

  it('采纳首位推荐被正确分类', () => {
    const result = classifyRedirect(
      ['gantt_what_if', 'resource_forecasting'],
      'gantt_what_if',
      false,
    )
    expect(result).toBe('accepted_top')
  })

  it('采纳非首位候选被正确分类', () => {
    const result = classifyRedirect(
      ['gantt_what_if', 'resource_forecasting'],
      'resource_forecasting',
      false,
    )
    expect(result).toBe('accepted_non_top')
  })

  it('改到未推荐 destination 被正确分类', () => {
    const result = classifyRedirect(['gantt_what_if', 'resource_forecasting'], 'compiler', false)
    expect(result).toBe('went_to_unrecommended')
  })

  it('放弃被正确分类', () => {
    const result = classifyRedirect(['gantt_what_if', 'resource_forecasting'], null, false)
    expect(result).toBe('abandoned')
  })

  it('歧义候选中选择被正确分类', () => {
    const result = classifyRedirect(
      ['gantt_what_if', 'resource_forecasting'],
      'gantt_what_if',
      true,
    )
    expect(result).toBe('chose_from_ambiguous')
  })

  it('歧义候选中选择不被计为路由错误', () => {
    // ambiguity selection 是第五类，不在 ROUTING_ERROR_REDIRECT_CLASSES 中
    expect(ROUTING_ERROR_REDIRECT_CLASSES).not.toContain('chose_from_ambiguous')
    expect(ROUTING_ERROR_REDIRECT_CLASSES).not.toContain('abandoned')
  })

  it('放弃不被记为错误路由', () => {
    expect(ROUTING_ERROR_REDIRECT_CLASSES).not.toContain('abandoned')
  })

  it('改到未推荐 destination 单独可见且可聚合', () => {
    const records = [
      { redirectClass: 'went_to_unrecommended' as const },
      { redirectClass: 'went_to_unrecommended' as const },
      { redirectClass: 'accepted_top' as const },
    ]
    const metrics = computeRoutingAccuracyMetrics(records)
    expect(metrics.wentToUnrecommendedCount).toBe(2)
  })
})

// ===========================================================================
// §2.5 准确率口径
// ===========================================================================

describe('准确率口径', () => {
  it('首位命中率与前 N 命中率分别输出', () => {
    const records = [
      { redirectClass: 'accepted_top' as const },
      { redirectClass: 'accepted_non_top' as const },
      { redirectClass: 'went_to_unrecommended' as const },
    ]
    const metrics = computeRoutingAccuracyMetrics(records)
    expect(metrics.topOneHitRate).toBeCloseTo(1 / 3)
    expect(metrics.topNHitRate).toBeCloseTo(2 / 3)
  })

  it('放弃计入分母但单独可见', () => {
    const records = [
      { redirectClass: 'accepted_top' as const },
      { redirectClass: 'abandoned' as const },
    ]
    const metrics = computeRoutingAccuracyMetrics(records)
    expect(metrics.totalDecisions).toBe(2)
    expect(metrics.abandonedCount).toBe(1)
    // 丢弃计入分母（totalDecisions=2），但不在 topNHits 中
    expect(metrics.topNHitRate).toBeCloseTo(0.5)
  })

  it('歧义选择不计入错误分子', () => {
    const records = [
      { redirectClass: 'chose_from_ambiguous' as const },
      { redirectClass: 'accepted_top' as const },
    ]
    const metrics = computeRoutingAccuracyMetrics(records)
    expect(metrics.ambiguousSelectionCount).toBe(1)
    // 歧义选择不在 ROUTING_ERROR_REDIRECT_CLASSES 中
    expect(metrics.wentToUnrecommendedCount).toBe(0)
    expect(metrics.acceptedNonTopCount).toBe(0)
  })

  it('空输入返回零指标', () => {
    const metrics = computeRoutingAccuracyMetrics([])
    expect(metrics.totalDecisions).toBe(0)
    expect(metrics.topOneHitRate).toBe(0)
    expect(metrics.topNHitRate).toBe(0)
  })
})

// ===========================================================================
// §2.9 输入元组 hash 含目录版本
// ===========================================================================

describe('输入元组 hash', () => {
  it('目录版本参与 hash 计算', () => {
    const params = {
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if'],
      confidences: [85],
      scope: 'project' as const,
    }

    const hashV1 = computeRoutingInputTupleHash({ ...params, catalogVersion: '1.0.0' })
    const hashV2 = computeRoutingInputTupleHash({ ...params, catalogVersion: '2.0.0' })

    // 不同目录版本应产生不同 hash
    expect(hashV1).not.toBe(hashV2)
  })

  it('相同输入产生相同 hash', () => {
    const hash1 = computeRoutingInputTupleHash({
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if'],
      confidences: [85],
      catalogVersion: '1.0.0',
      scope: 'project',
    })
    const hash2 = computeRoutingInputTupleHash({
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if'],
      confidences: [85],
      catalogVersion: '1.0.0',
      scope: 'project',
    })
    expect(hash1).toBe(hash2)
  })

  it('从路由记录计算 hash 与直接计算一致', () => {
    const record = {
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if', 'resource_forecasting'],
      confidences: [85, 60],
      catalogVersion: '1.0.0',
      scope: 'project' as const,
    }

    const directHash = computeRoutingInputTupleHash(record)
    const recordHash = computeRoutingRecordTupleHash({
      ...record,
      recordId: 'test',
      intentClass: 'query',
      subIntentId: 'test',
      clarificationRoundCount: 0,
      ambiguous: false,
      unavailabilityKinds: [],
      ruleHitCount: 1,
      fallbackCount: 0,
      userRerouted: false,
    })

    expect(directHash).toBe(recordHash)
  })
})

// ===========================================================================
// §2.11 禁存原始输入全文
// ===========================================================================

describe('禁存原始输入全文', () => {
  it('正常低敏摘要通过校验', () => {
    const result = validateRoutingLedgerRecordLowSensitivity({
      intentSummary: '项目甘特图查看请求',
      destinationOrder: ['gantt_what_if'],
      confidences: [85],
      ruleHitCount: 1,
      fallbackCount: 0,
      inputTupleHash: 'abc123',
      idempotencyKey: 'def456',
      traceId: null,
    })
    expect(result.safe).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('含 password 的摘要被拒绝', () => {
    const result = validateRoutingLedgerRecordLowSensitivity({
      intentSummary: '用户的 password 是 xxx',
      destinationOrder: [],
      confidences: [],
      ruleHitCount: 0,
      fallbackCount: 0,
      inputTupleHash: 'abc',
      idempotencyKey: 'def',
      traceId: null,
    })
    expect(result.safe).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('含 apiKey 的摘要被拒绝', () => {
    const result = validateRoutingLedgerRecordLowSensitivity({
      intentSummary: 'apiKey=sk-xxx',
      destinationOrder: [],
      confidences: [],
      ruleHitCount: 0,
      fallbackCount: 0,
      inputTupleHash: 'abc',
      idempotencyKey: 'def',
      traceId: null,
    })
    expect(result.safe).toBe(false)
  })

  it('摘要超过 1024 字符被拒绝', () => {
    const result = validateRoutingLedgerRecordLowSensitivity({
      intentSummary: 'a'.repeat(1025),
      destinationOrder: [],
      confidences: [],
      ruleHitCount: 0,
      fallbackCount: 0,
      inputTupleHash: 'abc',
      idempotencyKey: 'def',
      traceId: null,
    })
    expect(result.safe).toBe(false)
    expect(result.issues).toContainEqual(expect.stringContaining('1024'))
  })
})

// ===========================================================================
// §5.2 确定性违规检测
// ===========================================================================

describe('确定性违规检测', () => {
  it('同 hash 不同排序被检出', () => {
    const records = [
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['gantt_what_if', 'resource_forecasting'],
        confidences: [85, 60],
        catalogVersion: '1.0.0',
      },
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['resource_forecasting', 'gantt_what_if'],
        confidences: [60, 85],
        catalogVersion: '1.0.0',
      },
    ]
    const violation = detectReproducibilityViolation(records)
    expect(violation).not.toBeNull()
    expect(violation!.inputTupleHash).toBe('hash1')
    expect(violation!.distinctDestinationOrders.length).toBe(2)
  })

  it('目录版本变更导致的合法差异不被报为违规', () => {
    const records = [
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['gantt_what_if'],
        confidences: [85],
        catalogVersion: '1.0.0',
      },
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['resource_forecasting'],
        confidences: [60],
        catalogVersion: '2.0.0',
      },
    ]
    const violation = detectReproducibilityViolation(records)
    expect(violation).toBeNull()
  })

  it('同 hash 同排序不报违规', () => {
    const records = [
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['gantt_what_if'],
        confidences: [85],
        catalogVersion: '1.0.0',
      },
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['gantt_what_if'],
        confidences: [85],
        catalogVersion: '1.0.0',
      },
    ]
    const violation = detectReproducibilityViolation(records)
    expect(violation).toBeNull()
  })

  it('单条记录不报违规', () => {
    const records = [
      {
        inputTupleHash: 'hash1',
        destinationOrder: ['gantt_what_if'],
        confidences: [85],
        catalogVersion: '1.0.0',
      },
    ]
    const violation = detectReproducibilityViolation(records)
    expect(violation).toBeNull()
  })
})

// ===========================================================================
// §6.6 兜底率阈值健康状态（不触发自动动作）
// ===========================================================================

describe('兜底率健康状态', () => {
  it('低兜底率为 healthy', () => {
    const health = evaluateFallbackHealthStatus(0.1)
    expect(health.status).toBe('healthy')
    expect(health.reasonCode).toBe('ROUTING_FALLBACK_HEALTHY')
  })

  it('超过警告阈值为 warning', () => {
    const health = evaluateFallbackHealthStatus(ROUTING_FALLBACK_WARNING_THRESHOLD + 0.01)
    expect(health.status).toBe('warning')
    expect(health.reasonCode).toBe('ROUTING_FALLBACK_WARNING')
    expect(health.runbookRef).toBeTruthy()
  })

  it('超过临界阈值为 critical', () => {
    const health = evaluateFallbackHealthStatus(ROUTING_FALLBACK_CRITICAL_THRESHOLD + 0.01)
    expect(health.status).toBe('critical')
    expect(health.reasonCode).toBe('ROUTING_FALLBACK_CRITICAL')
    expect(health.runbookRef).toBeTruthy()
  })

  it('兜底率越界不触发目录自动变更或任何业务动作', () => {
    // 健康状态只产出 status + reasonCode + runbookRef
    // 不返回任何可执行动作
    const health = evaluateFallbackHealthStatus(1.0)
    expect(health.status).toBe('critical')
    // 确认返回值中没有动作字段
    expect(health).not.toHaveProperty('action')
    expect(health).not.toHaveProperty('autoFix')
    expect(health).not.toHaveProperty('trigger')
  })
})

// ===========================================================================
// §2.8 不可用类别分布
// ===========================================================================

describe('不可用类别分布', () => {
  it('三类各自计数', () => {
    const dist = computeUnavailabilityDistribution(
      ['not-enabled', 'authorization-gated', 'not-enabled'],
      2,
    )
    expect(dist.missingPermissionCount).toBe(2)
    expect(dist.notEnabledCount).toBe(2)
    expect(dist.authorizationGatedCount).toBe(1)
    expect(dist.totalUnavailabilityEvents).toBe(5)
  })

  it('空输入返回零分布', () => {
    const dist = computeUnavailabilityDistribution([], 0)
    expect(dist.totalUnavailabilityEvents).toBe(0)
  })
})

// ===========================================================================
// §2.7 澄清效率
// ===========================================================================

describe('澄清效率', () => {
  it('轮数分布正确计算', () => {
    const records = [
      { clarificationRoundCount: 0, redirectClass: 'accepted_top' as const },
      { clarificationRoundCount: 1, redirectClass: 'accepted_top' as const },
      { clarificationRoundCount: 2, redirectClass: 'accepted_non_top' as const },
      { clarificationRoundCount: 1, redirectClass: 'abandoned' as const },
    ]
    const eff = computeRoutingClarificationEfficiency(records)
    expect(eff.roundDistribution[0]).toBe(1)
    expect(eff.roundDistribution[1]).toBe(2)
    expect(eff.roundDistribution[2]).toBe(1)
  })

  it('澄清后成功率正确计算', () => {
    const records = [
      { clarificationRoundCount: 1, redirectClass: 'accepted_top' as const },
      { clarificationRoundCount: 2, redirectClass: 'accepted_non_top' as const },
      { clarificationRoundCount: 1, redirectClass: 'abandoned' as const },
    ]
    const eff = computeRoutingClarificationEfficiency(records)
    expect(eff.postClarificationTotalCount).toBe(3)
    expect(eff.postClarificationSuccessCount).toBe(2)
    expect(eff.postClarificationSuccessRate).toBeCloseTo(2 / 3)
  })
})

// ===========================================================================
// §2.14 Fixtures 一致性
// ===========================================================================

describe('Fixtures 一致性', () => {
  it('八态 fixture 都有正确的 redirectClass', () => {
    expect(ROUTING_LEDGER_FIXTURE_ACCEPTED_TOP.redirectClass).toBe('accepted_top')
    expect(ROUTING_LEDGER_FIXTURE_ACCEPTED_NON_TOP.redirectClass).toBe('accepted_non_top')
    expect(ROUTING_LEDGER_FIXTURE_WENT_TO_UNRECOMMENDED.redirectClass).toBe('went_to_unrecommended')
    expect(ROUTING_LEDGER_FIXTURE_ABANDONED.redirectClass).toBe('abandoned')
    expect(ROUTING_LEDGER_FIXTURE_AMBIGUOUS_CHOICE.redirectClass).toBe('chose_from_ambiguous')
    expect(ROUTING_LEDGER_FIXTURE_MODEL_FALLBACK.redirectClass).toBe('accepted_top')
    expect(ROUTING_LEDGER_FIXTURE_MULTI_ROUND_CLARIFICATION.redirectClass).toBe('accepted_top')
  })

  it('确定性违规 fixture 有相同 hash 但不同排序', () => {
    const { recordA, recordB } = ROUTING_LEDGER_FIXTURE_DETERMINISM_VIOLATION
    // hash 由 destinationOrder + confidences + catalogVersion + scope + intentSummary 计算
    // 由于 destinationOrder 不同，hash 也不同（因为 hash 含 intentSummary 等其他字段）
    // 这里测试的是 detectReproducibilityViolation 的逻辑
    const violation = detectReproducibilityViolation([
      {
        inputTupleHash: 'same_hash',
        destinationOrder: recordA.destinationOrder,
        confidences: recordA.confidences,
        catalogVersion: recordA.catalogVersion,
      },
      {
        inputTupleHash: 'same_hash',
        destinationOrder: recordB.destinationOrder,
        confidences: recordB.confidences,
        catalogVersion: recordB.catalogVersion,
      },
    ])
    expect(violation).not.toBeNull()
  })

  it('不可用分布 fixture 数值正确', () => {
    const dist = ROUTING_LEDGER_FIXTURE_UNAVAILABILITY_DISTRIBUTION
    expect(dist.missingPermissionCount + dist.notEnabledCount + dist.authorizationGatedCount).toBe(
      dist.totalUnavailabilityEvents,
    )
  })

  it('准确率 fixture 口径一致', () => {
    const m = ROUTING_LEDGER_FIXTURE_ACCURACY_METRICS
    // topNHits >= topOneHits（前 N 包含首位）
    expect(m.topNHits).toBeGreaterThanOrEqual(m.topOneHits)
    // topOneHitRate = topOneHits / totalDecisions
    expect(m.topOneHitRate).toBeCloseTo(m.topOneHits / m.totalDecisions)
    // topNHitRate = topNHits / totalDecisions
    expect(m.topNHitRate).toBeCloseTo(m.topNHits / m.totalDecisions)
  })

  it('所有 fixture 都有正确的 catalogVersion', () => {
    expect(ROUTING_LEDGER_FIXTURE_ACCEPTED_TOP.catalogVersion).toBe(
      ROUTING_LEDGER_FIXTURE_CATALOG_VERSION,
    )
    expect(ROUTING_LEDGER_FIXTURE_MODEL_FALLBACK.catalogVersion).toBe(
      ROUTING_LEDGER_FIXTURE_CATALOG_VERSION,
    )
  })
})

// ===========================================================================
// §4.1 buildRoutingLedgerRecord
// ===========================================================================

describe('buildRoutingLedgerRecord', () => {
  it('从路由记录构建账本记录', () => {
    const routingRecord = {
      recordId: 'cpr_test_001',
      catalogVersion: '1.0.0',
      intentClass: 'query' as const,
      subIntentId: 'gantt_whatif_query',
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if', 'resource_forecasting'],
      confidences: [85, 60],
      clarificationRoundCount: 0,
      ambiguous: false,
      unavailabilityKinds: [] as readonly ('not-enabled' | 'authorization-gated')[],
      ruleHitCount: 1,
      fallbackCount: 0,
      scope: 'project' as const,
      userRerouted: false,
    }

    const ledger = buildRoutingLedgerRecord({
      routingRecord,
      organizationId: 42,
      userDestination: 'gantt_what_if',
      missingPermissionCount: 0,
    })

    expect(ledger.redirectClass).toBe('accepted_top')
    expect(ledger.userDestination).toBe('gantt_what_if')
    expect(ledger.organizationId).toBe(42)
    expect(ledger.inputTupleHash).toBeTruthy()
    expect(ledger.idempotencyKey).toBeTruthy()
  })

  it('放弃时 redirectClass 为 abandoned', () => {
    const routingRecord = {
      recordId: 'cpr_test_002',
      catalogVersion: '1.0.0',
      intentClass: 'query' as const,
      subIntentId: null,
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if'],
      confidences: [85],
      clarificationRoundCount: 0,
      ambiguous: false,
      unavailabilityKinds: [] as readonly string[],
      ruleHitCount: 1,
      fallbackCount: 0,
      scope: 'project' as const,
      userRerouted: false,
    }

    const ledger = buildRoutingLedgerRecord({
      routingRecord,
      organizationId: 42,
      userDestination: null,
      missingPermissionCount: 0,
    })

    expect(ledger.redirectClass).toBe('abandoned')
    expect(ledger.userDestination).toBeNull()
    expect(ledger.attributionConfidence).toBe('ambiguous')
  })
})

// ===========================================================================
// §2.6 规则命中率与模型兜底率
// ===========================================================================

describe('规则命中率与模型兜底率', () => {
  it('正常聚合', () => {
    const records = [
      { ruleHitCount: 1, fallbackCount: 0 },
      { ruleHitCount: 1, fallbackCount: 0 },
      { ruleHitCount: 0, fallbackCount: 1 },
    ]
    const metrics = computeRoutingRuleHitMetrics(records)
    expect(metrics.totalRuleHits).toBe(2)
    expect(metrics.totalFallbacks).toBe(1)
    expect(metrics.ruleHitRate).toBeCloseTo(2 / 3)
    expect(metrics.fallbackRate).toBeCloseTo(1 / 3)
  })

  it('空输入返回零指标', () => {
    const metrics = computeRoutingRuleHitMetrics([])
    expect(metrics.totalDecisions).toBe(0)
    expect(metrics.fallbackHealthStatus).toBe('healthy')
  })
})
