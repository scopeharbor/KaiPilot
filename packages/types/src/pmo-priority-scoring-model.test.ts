/**
 * pmo-priority-scoring-model 类型测试
 *
 * 覆盖 DTO 形状、评分确定性、权重版本稳定性、优先级阈值边界、
 * tie-breaker 稳定性、输入签名稳定性、无效键拒绝等。
 */

import { describe, it, expect } from 'vitest'
import {
  PRIORITY_LEVELS,
  SCORE_DIMENSION_KEYS,
  SCORE_VERSIONS,
  SUPPORTED_PRIORITY_SORT_KEYS,
  SUPPORTED_PRIORITY_GROUP_KEYS,
  DEFAULT_SCORE_VERSION,
  PRIORITY_LEVEL_SCORE_RANGE,
  SCORE_WEIGHT_CATALOGUE,
  resolveScoreWeights,
  resolveDimensionWeight,
  normalizeDimensionValue,
  computeWeightedContribution,
  roundScore,
  derivePriorityLevel,
  priorityTieBreakerSort,
  computePriorityInputSignature,
  isPrioritySourceStale,
  isValidScoreVersion,
  isValidPriorityLevel,
  isValidPrioritySortKey,
  isValidPriorityGroupKey,
  DEFAULT_FRESHNESS_THRESHOLD_MS,
  type PriorityLevel,
  type ScoreDimensionKey,
  type ScoreVersion,
} from '../src/pmo-priority-scoring-model.js'
import {
  makeNormalPriorityItem,
  makeHighUrgencyPriorityItem,
  makePermissionRestrictedPriorityItem,
  makeStaleSourcePriorityItem,
  makeEmptyPortfolioSummary,
  makeUnavailableStrategicAttentionItem,
  makeLargePortfolioItems,
  makeLargePortfolioSummary,
  makeGroupSlice,
  makeWeightVersionDetail,
  makePriorityDetail,
  makeUnrankedPriorityItem,
  makeTieBreaker,
  makeInputSignature,
  makeDimensionContribution,
} from '../src/pmo-priority-scoring-model-fixtures.js'

// ─── §1 DTO 形状验证 ──────────────────────────────────────────

describe('DTO 形状', () => {
  it('makeNormalPriorityItem 产生完整 PriorityScoreItem', () => {
    const item = makeNormalPriorityItem(1, '测试项目')
    expect(item.projectId).toBe(1)
    expect(item.projectName).toBe('测试项目')
    expect(item.priorityScore).toBeGreaterThan(0)
    expect(PRIORITY_LEVELS).toContain(item.priorityLevel)
    expect(item.rank).toBeGreaterThan(0)
    expect(SCORE_VERSIONS).toContain(item.scoreVersion)
    expect(item.inputSignature.version).toBe(DEFAULT_SCORE_VERSION)
    expect(item.dimensions.length).toBe(SCORE_DIMENSION_KEYS.length)
    expect(item.topReasons.length).toBeLessThanOrEqual(3)
    expect(item.tieBreaker.projectId).toBe(1)
  })

  it('makeEmptyPortfolioSummary 产生空摘要', () => {
    const s = makeEmptyPortfolioSummary()
    expect(s.totalProjects).toBe(0)
    expect(s.scoredProjects).toBe(0)
    expect(s.warnings).toHaveLength(1)
    expect(s.warnings[0].code).toBe('EMPTY_PORTFOLIO')
  })

  it('makeLargePortfolioSummary 产生正确计数', () => {
    const s = makeLargePortfolioSummary(1000)
    expect(s.totalProjects).toBe(1000)
    expect(s.scoredProjects).toBe(1000)
    const total =
      s.levelCounts.critical +
      s.levelCounts.high +
      s.levelCounts.medium +
      s.levelCounts.low +
      s.levelCounts.unranked
    expect(total).toBe(1000)
  })

  it('makeWeightVersionDetail 产生完整权重说明', () => {
    const v = makeWeightVersionDetail()
    expect(v.version).toBe(DEFAULT_SCORE_VERSION)
    expect(v.dimensions.length).toBe(SCORE_DIMENSION_KEYS.length)
    expect(v.thresholds.critical[0]).toBe(80)
    expect(v.description).toBeTruthy()
  })
})

// ─── §2 评分确定性 ────────────────────────────────────────────

describe('评分确定性', () => {
  it('normalizeDimensionValue 在 0-100 范围内', () => {
    expect(normalizeDimensionValue(50, [0, 100])).toBe(50)
    expect(normalizeDimensionValue(0, [0, 100])).toBe(0)
    expect(normalizeDimensionValue(100, [0, 100])).toBe(100)
  })

  it('normalizeDimensionValue 夹紧超出范围的值', () => {
    expect(normalizeDimensionValue(-10, [0, 100])).toBe(0)
    expect(normalizeDimensionValue(200, [0, 100])).toBe(100)
  })

  it('normalizeDimensionValue 同值范围返回 50', () => {
    expect(normalizeDimensionValue(42, [42, 42])).toBe(50)
  })

  it('computeWeightedContribution 精确计算', () => {
    expect(computeWeightedContribution(80, 0.25)).toBe(20)
    expect(computeWeightedContribution(0, 0.5)).toBe(0)
    expect(computeWeightedContribution(100, 1)).toBe(100)
  })

  it('roundScore 四舍五入', () => {
    expect(roundScore(72.345)).toBe(72.35)
    expect(roundScore(72.344)).toBe(72.34)
  })

  it('derivePriorityLevel 正确分级', () => {
    expect(derivePriorityLevel(85)).toBe('critical')
    expect(derivePriorityLevel(80)).toBe('critical')
    expect(derivePriorityLevel(65)).toBe('high')
    expect(derivePriorityLevel(60)).toBe('high')
    expect(derivePriorityLevel(45)).toBe('medium')
    expect(derivePriorityLevel(40)).toBe('medium')
    expect(derivePriorityLevel(20)).toBe('low')
    expect(derivePriorityLevel(-1)).toBe('unranked')
  })
})

// ─── §3 权重版本稳定性 ────────────────────────────────────────

describe('权重版本稳定性', () => {
  it('pmo-priority-v1 维度权重和为 1', () => {
    const weights = SCORE_WEIGHT_CATALOGUE['pmo-priority-v1']
    const total = weights.reduce((s, d) => s + d.weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('resolveScoreWeights 返回正确版本', () => {
    const weights = resolveScoreWeights('pmo-priority-v1')
    expect(weights.length).toBe(8)
    expect(weights[0].key).toBe('delivery_urgency')
  })

  it('resolveScoreWeights 未知版本抛出', () => {
    expect(() => resolveScoreWeights('unknown-version' as ScoreVersion)).toThrow()
  })

  it('resolveDimensionWeight 返回正确维度', () => {
    const dw = resolveDimensionWeight('pmo-priority-v1', 'delivery_urgency')
    expect(dw.weight).toBe(0.25)
  })

  it('resolveDimensionWeight 未知维度抛出', () => {
    expect(() =>
      resolveDimensionWeight('pmo-priority-v1', 'unknown' as ScoreDimensionKey),
    ).toThrow()
  })
})

// ─── §4 优先级阈值边界 ────────────────────────────────────────

describe('优先级阈值边界', () => {
  it('PRIORITY_LEVEL_SCORE_RANGE 覆盖所有等级', () => {
    for (const level of PRIORITY_LEVELS) {
      expect(PRIORITY_LEVEL_SCORE_RANGE[level]).toBeDefined()
    }
  })

  it('阈值边界精确', () => {
    expect(PRIORITY_LEVEL_SCORE_RANGE.critical[0]).toBe(80)
    expect(PRIORITY_LEVEL_SCORE_RANGE.high[0]).toBe(60)
    expect(PRIORITY_LEVEL_SCORE_RANGE.medium[0]).toBe(40)
    expect(PRIORITY_LEVEL_SCORE_RANGE.low[0]).toBe(0)
  })

  it('自定义阈值生效', () => {
    const custom = {
      critical: [90, 100] as [number, number],
      high: [70, 90] as [number, number],
      medium: [50, 70] as [number, number],
      low: [0, 50] as [number, number],
      unranked: [-1, -1] as [number, number],
    }
    expect(derivePriorityLevel(85, custom)).toBe('high')
    expect(derivePriorityLevel(92, custom)).toBe('critical')
  })
})

// ─── §5 tie-breaker 稳定性 ────────────────────────────────────

describe('tie-breaker 稳定性', () => {
  it('同分按等级排', () => {
    const a = makeTieBreaker('high', 50, 50, 1)
    const b = makeTieBreaker('medium', 50, 50, 2)
    expect(priorityTieBreakerSort(a, b)).toBeLessThan(0)
  })

  it('同等级按交通灯严重度排', () => {
    const a = makeTieBreaker('high', 80, 50, 1)
    const b = makeTieBreaker('high', 50, 50, 2)
    expect(priorityTieBreakerSort(a, b)).toBeLessThan(0)
  })

  it('同灯色按截止日紧急度排', () => {
    const a = makeTieBreaker('high', 50, 90, 1)
    const b = makeTieBreaker('high', 50, 50, 2)
    expect(priorityTieBreakerSort(a, b)).toBeLessThan(0)
  })

  it('完全相同按 projectId 排', () => {
    const a = makeTieBreaker('high', 50, 50, 1)
    const b = makeTieBreaker('high', 50, 50, 2)
    expect(priorityTieBreakerSort(a, b)).toBeLessThan(0)
  })

  it('unranked 排最后', () => {
    const a = makeTieBreaker('low', 10, 10, 1)
    const b = makeTieBreaker('unranked', -1, -1, 2)
    expect(priorityTieBreakerSort(a, b)).toBeLessThan(0)
  })
})

// ─── §6 输入签名稳定性 ────────────────────────────────────────

describe('输入签名稳定性', () => {
  it('相同输入产生相同签名', () => {
    const sig1 = computePriorityInputSignature('pmo-priority-v1', 1, {
      a: 1,
      b: 2,
    })
    const sig2 = computePriorityInputSignature('pmo-priority-v1', 1, {
      a: 1,
      b: 2,
    })
    expect(sig1.inputsHash).toBe(sig2.inputsHash)
    expect(sig1.organizationHash).toBe(sig2.organizationHash)
  })

  it('不同输入产生不同签名', () => {
    const sig1 = computePriorityInputSignature('pmo-priority-v1', 1, { a: 1 })
    const sig2 = computePriorityInputSignature('pmo-priority-v1', 1, { a: 2 })
    expect(sig1.inputsHash).not.toBe(sig2.inputsHash)
  })

  it('不同组织产生不同签名', () => {
    const sig1 = computePriorityInputSignature('pmo-priority-v1', 1, { a: 1 })
    const sig2 = computePriorityInputSignature('pmo-priority-v1', 2, { a: 1 })
    expect(sig1.organizationHash).not.toBe(sig2.organizationHash)
  })
})

// ─── §7 无效键拒绝 ────────────────────────────────────────────

describe('无效键拒绝', () => {
  it('isValidScoreVersion', () => {
    expect(isValidScoreVersion('pmo-priority-v1')).toBe(true)
    expect(isValidScoreVersion('invalid')).toBe(false)
  })

  it('isValidPriorityLevel', () => {
    expect(isValidPriorityLevel('critical')).toBe(true)
    expect(isValidPriorityLevel('urgent')).toBe(false)
  })

  it('isValidPrioritySortKey', () => {
    expect(isValidPrioritySortKey('priority_score')).toBe(true)
    expect(isValidPrioritySortKey('invalid_sort')).toBe(false)
  })

  it('isValidPriorityGroupKey', () => {
    expect(isValidPriorityGroupKey('priority_level')).toBe(true)
    expect(isValidPriorityGroupKey('invalid_group')).toBe(false)
  })
})

// ─── §8 源新鲜度 ──────────────────────────────────────────────

describe('源新鲜度', () => {
  it('null 视为过期', () => {
    expect(isPrioritySourceStale(null)).toBe(true)
  })

  it('24h 内不算过期', () => {
    const recent = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    expect(isPrioritySourceStale(recent)).toBe(false)
  })

  it('超过 24h 算过期', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(isPrioritySourceStale(old)).toBe(true)
  })

  it('支持自定义阈值', () => {
    const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString()
    expect(isPrioritySourceStale(oneHourAgo, 60 * 60 * 1000)).toBe(true)
  })
})

// ─── §9 高紧急度项目 ──────────────────────────────────────────

describe('高紧急度项目', () => {
  it('makeHighUrgencyPriorityItem 等级为 critical', () => {
    const item = makeHighUrgencyPriorityItem(1)
    expect(item.priorityLevel).toBe('critical')
    expect(item.priorityScore).toBeGreaterThanOrEqual(80)
    expect(item.topReasons[0].dimension).toBe('delivery_urgency')
  })
})

// ─── §10 权限脱敏 ─────────────────────────────────────────────

describe('权限脱敏项目', () => {
  it('makePermissionRestrictedPriorityItem 脱敏风险/资源维度', () => {
    const item = makePermissionRestrictedPriorityItem(1)
    const risk = item.dimensions.find((d) => d.dimension === 'risk_pressure')
    expect(risk!.availability).toBe('forbidden')
    expect(risk!.evidenceRefs).toHaveLength(0)
    const resource = item.dimensions.find((d) => d.dimension === 'resource_pressure')
    expect(resource!.availability).toBe('forbidden')
  })

  it('脱敏维度不出现在 topReasons 中', () => {
    const item = makePermissionRestrictedPriorityItem(1)
    for (const reason of item.topReasons) {
      expect(reason.availability).not.toBe('forbidden')
    }
  })
})

// ─── §11 过期源项目 ───────────────────────────────────────────

describe('过期源项目', () => {
  it('makeStaleSourcePriorityItem 有过期 warning', () => {
    const item = makeStaleSourcePriorityItem(1)
    const staleWarnings = item.warnings.filter((w) => w.code === 'SOURCE_STALE')
    expect(staleWarnings.length).toBeGreaterThan(0)
  })

  it('freshness 维度为 stale', () => {
    const item = makeStaleSourcePriorityItem(1)
    const freshness = item.dimensions.find((d) => d.dimension === 'freshness')
    expect(freshness!.availability).toBe('stale')
  })
})

// ─── §12 战略关注不可用 ───────────────────────────────────────

describe('战略关注不可用', () => {
  it('makeUnavailableStrategicAttentionItem 标记 management_attention 为 unavailable', () => {
    const item = makeUnavailableStrategicAttentionItem(1)
    const ma = item.dimensions.find((d) => d.dimension === 'management_attention')
    expect(ma!.availability).toBe('unavailable')
    expect(ma!.warning).toBe('DIMENSION_UNAVAILABLE')
  })
})

// ─── §13 大组合 ────────────────────────────────────────────────

describe('大组合', () => {
  it('makeLargePortfolioItems 产生正确数量', () => {
    const items = makeLargePortfolioItems(100)
    expect(items).toHaveLength(100)
  })

  it('大组合按等级排序', () => {
    const items = makeLargePortfolioItems(100)
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].priorityScore).toBeGreaterThanOrEqual(items[i].priorityScore)
    }
  })

  it('makeLargePortfolioItems 1000 条可生成', () => {
    const items = makeLargePortfolioItems(1000)
    expect(items).toHaveLength(1000)
  })
})

// ─── §14 分组切片 ─────────────────────────────────────────────

describe('分组切片', () => {
  it('makeGroupSlice 产生正确结构', () => {
    const s = makeGroupSlice('priority_level', 'high', 25, 72.5)
    expect(s.groupKey).toBe('priority_level')
    expect(s.groupValue).toBe('high')
    expect(s.count).toBe(25)
    expect(s.averageScore).toBe(72.5)
  })
})

// ─── §15 项目详情 ─────────────────────────────────────────────

describe('项目详情评分', () => {
  it('makePriorityDetail 包含分组切片', () => {
    const detail = makePriorityDetail(1, '测试')
    expect(detail.groupSlices).toBeDefined()
    expect(detail.groupSlices!.length).toBeGreaterThan(0)
  })
})

// ─── §16 未评分项目 ───────────────────────────────────────────

describe('未评分项目', () => {
  it('makeUnrankedPriorityItem 返回 unranked', () => {
    const item = makeUnrankedPriorityItem(1)
    expect(item.priorityLevel).toBe('unranked')
    expect(item.priorityScore).toBe(-1)
    expect(item.rank).toBe(-1)
    expect(item.dimensions.every((d) => d.availability === 'unavailable')).toBe(true)
  })
})

// ─── §17 高紧急度排序验证 ─────────────────────────────────────

describe('高紧急度排序', () => {
  it('critical 排在 high 之前', () => {
    const critical = makeHighUrgencyPriorityItem(1)
    const high = makeNormalPriorityItem(2, '普通')
    expect(critical.priorityScore).toBeGreaterThan(high.priorityScore)
    expect(critical.priorityLevel).toBe('critical')
    expect(high.priorityLevel).toBe('high')
  })
})
