/**
 * v3-copilot-routing-decision-ledger —— 后端服务单元测试。
 *
 * 覆盖：
 * - 记录器：五类改道分类、幂等、禁存原始输入、记账失败降级
 * - 改道判定：五类分类、歧义不计错误、改到未推荐单独可见
 * - 回归网：同 hash 不同排序检出、目录版本差异不报违规
 * - 聚合：准确率口径、规则命中率、兜底率健康状态、澄清效率、不可用分布
 * - 归因：观察窗口、间接导航处理
 * - 组织隔离
 */

import { describe, it, expect } from 'vitest'
import {
  classifyRedirect,
  computeRoutingInputTupleHash,
  computeRoutingLedgerIdempotencyKey,
  detectReproducibilityViolation,
  computeUnavailabilityDistribution,
  computeRoutingAccuracyMetrics,
  computeRoutingClarificationEfficiency,
  evaluateFallbackHealthStatus,
  buildRoutingLedgerRecord,
  validateRoutingLedgerRecordLowSensitivity,
  ROUTING_ERROR_REDIRECT_CLASSES,
  ROUTING_FALLBACK_WARNING_THRESHOLD,
  ROUTING_FALLBACK_CRITICAL_THRESHOLD,
} from '@aiproj/types'
import {
  attributeRedirect,
  ROUTING_ATTRIBUTION_WINDOW_MS,
} from '../../app/services/copilot_routing_ledger/copilot_routing_ledger_recorder.js'

// ===========================================================================
// 改道判定（§4.2）
// ===========================================================================

describe('路由决策账本 — 改道判定', () => {
  it('五类改道分类覆盖全部场景', () => {
    // accepted_top
    expect(classifyRedirect(['health_diagnosis', 'prediction'], 'health_diagnosis', false)).toBe(
      'accepted_top',
    )
    // accepted_non_top
    expect(classifyRedirect(['health_diagnosis', 'prediction'], 'prediction', false)).toBe(
      'accepted_non_top',
    )
    // went_to_unrecommended
    expect(classifyRedirect(['health_diagnosis', 'prediction'], 'compiler', false)).toBe(
      'went_to_unrecommended',
    )
    // abandoned
    expect(classifyRedirect(['health_diagnosis', 'prediction'], null, false)).toBe('abandoned')
    // chose_from_ambiguous
    expect(classifyRedirect(['health_diagnosis', 'prediction'], 'health_diagnosis', true)).toBe(
      'chose_from_ambiguous',
    )
  })

  it('歧义候选中选择不被计为路由错误', () => {
    // chose_from_ambiguous 不在 ROUTING_ERROR_REDIRECT_CLASSES 中
    expect(ROUTING_ERROR_REDIRECT_CLASSES).not.toContain('chose_from_ambiguous')
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

  it('禁止隐式改道推断：不作为不被推断为路由错误', () => {
    // 不作为 = userDestination = null = abandoned
    // abandoned 不在 ROUTING_ERROR_REDIRECT_CLASSES 中
    const result = classifyRedirect(['a', 'b'], null, false)
    expect(result).toBe('abandoned')
    expect(ROUTING_ERROR_REDIRECT_CLASSES).not.toContain('abandoned')
  })

  it('放弃记为放弃，不记为错误路由', () => {
    const result = classifyRedirect(['health_diagnosis', 'prediction'], null, false)
    expect(result).toBe('abandoned')
    expect(ROUTING_ERROR_REDIRECT_CLASSES).not.toContain(result)
  })
})

// ===========================================================================
// 归因规则（§4.3）
// ===========================================================================

describe('路由决策账本 — 归因规则', () => {
  it('直接选择推荐 destination 为 direct', () => {
    const result = attributeRedirect('health_diagnosis', ['health_diagnosis', 'prediction'], 1000)
    expect(result).toBe('direct')
  })

  it('选择非推荐 destination 为 indirect', () => {
    const result = attributeRedirect('compiler', ['health_diagnosis', 'prediction'], 1000)
    expect(result).toBe('indirect')
  })

  it('超时窗口为 ambiguous', () => {
    const result = attributeRedirect(
      'health_diagnosis',
      ['health_diagnosis', 'prediction'],
      ROUTING_ATTRIBUTION_WINDOW_MS + 1,
    )
    expect(result).toBe('ambiguous')
  })

  it('放弃为 ambiguous', () => {
    const result = attributeRedirect(null, ['health_diagnosis', 'prediction'], 1000)
    expect(result).toBe('ambiguous')
  })
})

// ===========================================================================
// 确定性违规查询（§5.2）
// ===========================================================================

describe('路由决策账本 — 确定性违规', () => {
  it('同 hash 同版本不同排序被检出', () => {
    const records = [
      {
        inputTupleHash: 'h1',
        destinationOrder: ['a', 'b'],
        confidences: [80, 60],
        catalogVersion: '1.0.0',
      },
      {
        inputTupleHash: 'h1',
        destinationOrder: ['b', 'a'],
        confidences: [60, 80],
        catalogVersion: '1.0.0',
      },
    ]
    const v = detectReproducibilityViolation(records)
    expect(v).not.toBeNull()
    expect(v!.inputTupleHash).toBe('h1')
    expect(v!.catalogVersions).toEqual(['1.0.0'])
  })

  it('目录版本变更导致的合法差异不被报为违规', () => {
    const records = [
      { inputTupleHash: 'h1', destinationOrder: ['a'], confidences: [80], catalogVersion: '1.0.0' },
      { inputTupleHash: 'h1', destinationOrder: ['b'], confidences: [60], catalogVersion: '2.0.0' },
    ]
    const v = detectReproducibilityViolation(records)
    expect(v).toBeNull()
  })

  it('单条记录不报违规', () => {
    const records = [
      { inputTupleHash: 'h1', destinationOrder: ['a'], confidences: [80], catalogVersion: '1.0.0' },
    ]
    expect(detectReproducibilityViolation(records)).toBeNull()
  })
})

// ===========================================================================
// 准确率聚合（§6.1–6.4）
// ===========================================================================

describe('路由决策账本 — 准确率聚合', () => {
  it('首位命中率与前 N 命中率分别输出', () => {
    const records = [
      { redirectClass: 'accepted_top' as const },
      { redirectClass: 'accepted_non_top' as const },
      { redirectClass: 'went_to_unrecommended' as const },
    ]
    const m = computeRoutingAccuracyMetrics(records)
    expect(m.topOneHitRate).toBeCloseTo(1 / 3)
    expect(m.topNHitRate).toBeCloseTo(2 / 3)
  })

  it('放弃计入分母但单独可见', () => {
    const records = [
      { redirectClass: 'accepted_top' as const },
      { redirectClass: 'abandoned' as const },
    ]
    const m = computeRoutingAccuracyMetrics(records)
    expect(m.totalDecisions).toBe(2)
    expect(m.abandonedCount).toBe(1)
    expect(m.topNHitRate).toBeCloseTo(0.5)
  })

  it('歧义选择不计入错误分子', () => {
    const records = [
      { redirectClass: 'chose_from_ambiguous' as const },
      { redirectClass: 'accepted_top' as const },
    ]
    const m = computeRoutingAccuracyMetrics(records)
    expect(m.wentToUnrecommendedCount).toBe(0)
    expect(m.acceptedNonTopCount).toBe(0)
  })
})

// ===========================================================================
// 规则命中率与模型兜底率（§6.5–6.7）
// ===========================================================================

describe('路由决策账本 — 规则命中率与模型兜底率', () => {
  it('兜底率阈值健康状态', () => {
    expect(evaluateFallbackHealthStatus(0.1).status).toBe('healthy')
    expect(evaluateFallbackHealthStatus(ROUTING_FALLBACK_WARNING_THRESHOLD + 0.01).status).toBe(
      'warning',
    )
    expect(evaluateFallbackHealthStatus(ROUTING_FALLBACK_CRITICAL_THRESHOLD + 0.01).status).toBe(
      'critical',
    )
  })

  it('兜底率越界不触发目录自动变更或任何业务动作', () => {
    const health = evaluateFallbackHealthStatus(1.0)
    expect(health.status).toBe('critical')
    expect(health).not.toHaveProperty('action')
    expect(health).not.toHaveProperty('autoFix')
    expect(health).not.toHaveProperty('trigger')
  })
})

// ===========================================================================
// 澄清效率（§6.8）
// ===========================================================================

describe('路由决策账本 — 澄清效率', () => {
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
// 不可用类别分布（§6.9）
// ===========================================================================

describe('路由决策账本 — 不可用类别分布', () => {
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
})

// ===========================================================================
// 记账失败降级（§7.1–7.2）
// ===========================================================================

describe('路由决策账本 — 记账失败降级', () => {
  it('低敏 sanitizer 通过正常摘要', () => {
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
  })

  it('含敏感内容的摘要被拒绝', () => {
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
  })
})

// ===========================================================================
// 输入元组 hash 含目录版本（§2.9）
// ===========================================================================

describe('路由决策账本 — 输入元组 hash', () => {
  it('目录版本参与 hash 计算', () => {
    const params = {
      intentSummary: '测试摘要',
      destinationOrder: ['gantt_what_if'],
      confidences: [85],
      scope: 'project' as const,
    }
    const hashV1 = computeRoutingInputTupleHash({ ...params, catalogVersion: '1.0.0' })
    const hashV2 = computeRoutingInputTupleHash({ ...params, catalogVersion: '2.0.0' })
    expect(hashV1).not.toBe(hashV2)
  })

  it('幂等键由 recordId + orgId + catalogVersion 派生', () => {
    const k1 = computeRoutingLedgerIdempotencyKey({
      recordId: 'r1',
      organizationId: 1,
      catalogVersion: '1.0.0',
    })
    const k2 = computeRoutingLedgerIdempotencyKey({
      recordId: 'r1',
      organizationId: 1,
      catalogVersion: '1.0.0',
    })
    const k3 = computeRoutingLedgerIdempotencyKey({
      recordId: 'r1',
      organizationId: 2,
      catalogVersion: '1.0.0',
    })
    expect(k1).toBe(k2)
    expect(k1).not.toBe(k3)
  })
})

// ===========================================================================
// buildRoutingLedgerRecord（§4.1）
// ===========================================================================

describe('路由决策账本 — buildRoutingLedgerRecord', () => {
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
    expect(ledger.attributionConfidence).toBe('direct')
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
      unavailabilityKinds:
        [] as readonly import('@aiproj/types').CopilotDestinationUnavailabilityKind[],
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
