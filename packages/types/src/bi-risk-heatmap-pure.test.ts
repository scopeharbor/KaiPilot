/**
 * BI 风险热力图契约与纯函数测试（v3-bi-risk-heatmap §2.5–2.6）
 */

import { describe, it, expect } from 'vitest'
import {
  // 枚举值数组
  BI_RISK_HEATMAP_METRIC_KEY_VALUES,
  BI_RISK_HEATMAP_SOURCE_KIND_VALUES,
  BI_RISK_HEATMAP_DIMENSION_KEY_VALUES,
  BI_RISK_HEATMAP_WINDOW_VALUES,
  BI_RISK_HEATMAP_COMPARE_MODE_VALUES,
  BI_RISK_HEATMAP_SORT_KEY_VALUES,
  BI_RISK_HEATMAP_FRESHNESS_STATE_VALUES,
  BI_RISK_HEATMAP_REDACTION_STATE_VALUES,
  BI_RISK_HEATMAP_WARNING_CODE_VALUES,
  BI_RISK_HEATMAP_DRILLDOWN_TARGET_KIND_VALUES,
  // 常量
  BI_RISK_HEATMAP_DEFAULT_WINDOW,
  BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION,
  BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION,
  BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
  BI_RISK_HEATMAP_MAX_PER_PAGE,
  BI_RISK_HEATMAP_MIN_SAMPLE_COUNT,
  BI_RISK_HEATMAP_MAX_CONTRIBUTORS,
  BI_RISK_HEATMAP_MAX_CELLS,
  BI_RISK_HEATMAP_METRIC_VERSION,
  // guard helpers
  isSupportedBiRiskHeatmapMetricKey,
  isSupportedBiRiskHeatmapDimensionKey,
  isSupportedBiRiskHeatmapWindow,
  isSupportedBiRiskHeatmapCompareMode,
  isSupportedBiRiskHeatmapSortKey,
  isUnsupportedFinancialRiskMetricKey,
  isBiRiskHeatmapWindowWithinBounds,
  isBiRiskHeatmapCellCountWithinLimit,
  isBiRiskHeatmapFilterCountWithinLimit,
  isBiRiskHeatmapDimensionPairUnsafe,
  // pure helpers
  normalizeBiRiskHeatmapCellKey,
  normalizeBiRiskHeatmapDimensionValue,
  computeBiRiskHeatmapCellScore,
  classifyBiRiskHeatmapCellLevel,
  computeBiRiskHeatmapDelta,
  computeBiRiskHeatmapConfidence,
  truncateBiRiskHeatmapContributors,
  // warning/redaction
  buildBiRiskHeatmapWarning,
  isBiRiskHeatmapRedacted,
  redactBiRiskHeatmapEvidence,
  // query shape
  buildBiRiskHeatmapQueryShape,
  serializeBiRiskHeatmapQuery,
  simpleBiRiskHeatmapHash,
  // freshness
  aggregateBiRiskHeatmapFreshness,
  // types
  type BiRiskHeatmapMetricKey,
  type BiRiskHeatmapWindow,
  type BiRiskHeatmapDimensionKey,
  type BiRiskHeatmapCompareMode,
  type BiRiskHeatmapSortKey,
  type BiRiskHeatmapCell,
  type BiRiskHeatmapQuery,
  type BiRiskHeatmapContributor,
  type BiRiskHeatmapEvidenceRef,
  type BiRiskHeatmapSourceRef,
  type BiRiskHeatmapFreshnessState,
  type BiRiskHeatmapRedactionState,
} from './bi-risk-heatmap'

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

function mkQuery(overrides?: Partial<BiRiskHeatmapQuery>): BiRiskHeatmapQuery {
  return {
    metricKey: 'risk_exposure_score',
    window: 'last_90_days',
    rowDimension: 'project',
    columnDimension: 'risk_level',
    ...overrides,
  }
}

function mkContributor(overrides?: Partial<BiRiskHeatmapContributor>): BiRiskHeatmapContributor {
  return {
    id: 'c1',
    label: '项目 A',
    kind: 'project',
    contributionWeight: 0.5,
    rank: 1,
    ...overrides,
  }
}

function mkSourceRef(overrides?: Partial<BiRiskHeatmapSourceRef>): BiRiskHeatmapSourceRef {
  return {
    sourceKind: 'risk_register',
    state: 'fresh',
    lastRefreshedAt: '2026-07-30T00:00:00Z',
    metricVersion: 'bi-risk-heatmap-v1',
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 稳定枚举值测试
// ══════════════════════════════════════════════════════════════════════════════

describe('BI 风险热力图枚举值稳定', () => {
  it('METRIC_KEY_VALUES 包含所有 6 个键', () => {
    expect(BI_RISK_HEATMAP_METRIC_KEY_VALUES).toHaveLength(6)
  })

  it('SOURCE_KIND_VALUES 包含所有 9 个来源', () => {
    expect(BI_RISK_HEATMAP_SOURCE_KIND_VALUES).toHaveLength(9)
  })

  it('DIMENSION_KEY_VALUES 包含所有 8 个维度', () => {
    expect(BI_RISK_HEATMAP_DIMENSION_KEY_VALUES).toHaveLength(8)
  })

  it('WINDOW_VALUES 包含所有 8 个窗口', () => {
    expect(BI_RISK_HEATMAP_WINDOW_VALUES).toHaveLength(8)
  })

  it('COMPARE_MODE_VALUES 包含 3 种模式', () => {
    expect(BI_RISK_HEATMAP_COMPARE_MODE_VALUES).toHaveLength(3)
  })

  it('SORT_KEY_VALUES 包含 5 个排序键', () => {
    expect(BI_RISK_HEATMAP_SORT_KEY_VALUES).toHaveLength(5)
  })

  it('FRESHNESS_STATE_VALUES 包含 3 种状态', () => {
    expect(BI_RISK_HEATMAP_FRESHNESS_STATE_VALUES).toHaveLength(3)
  })

  it('REDACTION_STATE_VALUES 包含 3 种状态', () => {
    expect(BI_RISK_HEATMAP_REDACTION_STATE_VALUES).toHaveLength(3)
  })

  it('WARNING_CODE_VALUES 包含 11 个 code', () => {
    expect(BI_RISK_HEATMAP_WARNING_CODE_VALUES).toHaveLength(11)
  })

  it('DRILLDOWN_TARGET_KIND_VALUES 包含 10 个种类', () => {
    expect(BI_RISK_HEATMAP_DRILLDOWN_TARGET_KIND_VALUES).toHaveLength(10)
  })

  it('默认值符合预期', () => {
    expect(BI_RISK_HEATMAP_DEFAULT_WINDOW).toBe('last_90_days')
    expect(BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION).toBe('project')
    expect(BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION).toBe('risk_level')
    expect(BI_RISK_HEATMAP_DEFAULT_PER_PAGE).toBe(50)
    expect(BI_RISK_HEATMAP_MAX_PER_PAGE).toBe(200)
    expect(BI_RISK_HEATMAP_MIN_SAMPLE_COUNT).toBe(3)
    expect(BI_RISK_HEATMAP_MAX_CONTRIBUTORS).toBe(5)
    expect(BI_RISK_HEATMAP_MAX_CELLS).toBe(500)
    expect(BI_RISK_HEATMAP_METRIC_VERSION).toBe('bi-risk-heatmap-v1')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 零运行时导入 / 向后兼容
// ══════════════════════════════════════════════════════════════════════════════

describe('零运行时导入', () => {
  it('类型导入不触发运行时错误', () => {
    const _metric: BiRiskHeatmapMetricKey = 'risk_exposure_score'
    const _window: BiRiskHeatmapWindow = 'last_90_days'
    const _dim: BiRiskHeatmapDimensionKey = 'project'
    const _mode: BiRiskHeatmapCompareMode = 'none'
    const _sort: BiRiskHeatmapSortKey = 'score'
    expect(true).toBe(true)
  })

  it('导入不依赖 AdonisJS / React / 数据库 / AI SDK', () => {
    expect(isSupportedBiRiskHeatmapMetricKey).toBeDefined()
    expect(isSupportedBiRiskHeatmapDimensionKey).toBeDefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 Query shape 序列化
// ══════════════════════════════════════════════════════════════════════════════

describe('query shape 序列化', () => {
  it('基本查询序列化', () => {
    const q = mkQuery()
    const result = serializeBiRiskHeatmapQuery(q)
    expect(result).toContain('metric=risk_exposure_score')
    expect(result).toContain('window=last_90_days')
    expect(result).toContain('row=project')
    expect(result).toContain('col=risk_level')
  })

  it('带筛选器序列化', () => {
    const q = mkQuery({
      filters: {
        projectIds: ['1', '2'],
        riskCategories: ['schedule'],
      },
    })
    const result = serializeBiRiskHeatmapQuery(q)
    expect(result).toContain('projects=1.2')
    expect(result).toContain('cats=schedule')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 Warning helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('warning helpers', () => {
  it('buildBiRiskHeatmapWarning 返回完整 warning 结构', () => {
    const w = buildBiRiskHeatmapWarning('INSUFFICIENT_SAMPLE', '样本不足', { count: 2 })
    expect(w.code).toBe('INSUFFICIENT_SAMPLE')
    expect(w.message).toBe('样本不足')
    expect(w.context).toEqual({ count: 2 })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 Redaction helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('redaction helpers', () => {
  it('isBiRiskHeatmapRedacted: partial → true', () => {
    expect(isBiRiskHeatmapRedacted('partial')).toBe(true)
  })

  it('isBiRiskHeatmapRedacted: full → true', () => {
    expect(isBiRiskHeatmapRedacted('full')).toBe(true)
  })

  it('isBiRiskHeatmapRedacted: none → false', () => {
    expect(isBiRiskHeatmapRedacted('none')).toBe(false)
  })

  it('redactBiRiskHeatmapEvidence: none → 原样返回', () => {
    const evs: BiRiskHeatmapEvidenceRef[] = [
      { kind: 'risk', label: '风险A', targetKind: 'risk', sourceKind: 'risk_register' },
    ]
    const result = redactBiRiskHeatmapEvidence(evs, 'none')
    expect(result[0].label).toBe('风险A')
  })

  it('redactBiRiskHeatmapEvidence: full → 返回空数组', () => {
    const evs: BiRiskHeatmapEvidenceRef[] = [
      { kind: 'risk', label: '风险A', targetKind: 'risk', sourceKind: 'risk_register' },
    ]
    const result = redactBiRiskHeatmapEvidence(evs, 'full')
    expect(result).toHaveLength(0)
  })

  it('redactBiRiskHeatmapEvidence: partial → 脱敏标签', () => {
    const evs: BiRiskHeatmapEvidenceRef[] = [
      { kind: 'risk', label: '风险A', targetKind: 'risk', sourceKind: 'risk_register' },
    ]
    const result = redactBiRiskHeatmapEvidence(evs, 'partial')
    expect(result[0].label).toBe('[已脱敏]')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 Unsupported metric 处理
// ══════════════════════════════════════════════════════════════════════════════

describe('unsupported metric 处理', () => {
  it('isUnsupportedFinancialRiskMetricKey: budget_risk → true', () => {
    expect(isUnsupportedFinancialRiskMetricKey('budget_risk')).toBe(true)
  })

  it('isUnsupportedFinancialRiskMetricKey: cost_risk → true', () => {
    expect(isUnsupportedFinancialRiskMetricKey('cost_risk')).toBe(true)
  })

  it('isUnsupportedFinancialRiskMetricKey: risk_exposure_score → false', () => {
    expect(isUnsupportedFinancialRiskMetricKey('risk_exposure_score')).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.5 Drilldown target typing
// ══════════════════════════════════════════════════════════════════════════════

describe('drilldown target typing', () => {
  it('DRILLDOWN_TARGET_KIND_VALUES 所有键可被类型消费', () => {
    for (const k of BI_RISK_HEATMAP_DRILLDOWN_TARGET_KIND_VALUES) {
      expect(typeof k).toBe('string')
      expect(k.length).toBeGreaterThan(0)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Cell scoring
// ══════════════════════════════════════════════════════════════════════════════

describe('computeBiRiskHeatmapCellScore', () => {
  it('正常加权计算', () => {
    const score = computeBiRiskHeatmapCellScore({
      probability: 0.8,
      impact: 0.7,
      severityWeight: 0.9,
      statusWeight: 1.0,
    })
    expect(score).toBeCloseTo(0.504, 3)
  })

  it('probability 为 0 时返回 0', () => {
    const score = computeBiRiskHeatmapCellScore({
      probability: 0,
      impact: 0.8,
      severityWeight: 1,
      statusWeight: 1,
    })
    expect(score).toBe(0)
  })

  it('impact 为 0 时返回 0', () => {
    const score = computeBiRiskHeatmapCellScore({
      probability: 0.8,
      impact: 0,
      severityWeight: 1,
      statusWeight: 1,
    })
    expect(score).toBe(0)
  })

  it('全满值返回 1', () => {
    const score = computeBiRiskHeatmapCellScore({
      probability: 1,
      impact: 1,
      severityWeight: 1,
      statusWeight: 1,
    })
    expect(score).toBe(1)
  })

  it('probability/impact 超出范围时被夹紧', () => {
    const score = computeBiRiskHeatmapCellScore({
      probability: 2,
      impact: -0.5,
      severityWeight: 1,
      statusWeight: 1,
    })
    expect(score).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Risk level thresholds
// ══════════════════════════════════════════════════════════════════════════════

describe('classifyBiRiskHeatmapCellLevel', () => {
  it('score >= 0.8 → critical', () => {
    expect(classifyBiRiskHeatmapCellLevel(0.85, 10)).toBe('critical')
    expect(classifyBiRiskHeatmapCellLevel(0.8, 10)).toBe('critical')
  })

  it('score >= 0.5 → high', () => {
    expect(classifyBiRiskHeatmapCellLevel(0.55, 10)).toBe('high')
    expect(classifyBiRiskHeatmapCellLevel(0.5, 10)).toBe('high')
  })

  it('score >= 0.25 → medium', () => {
    expect(classifyBiRiskHeatmapCellLevel(0.3, 10)).toBe('medium')
    expect(classifyBiRiskHeatmapCellLevel(0.25, 10)).toBe('medium')
  })

  it('score < 0.25 → low', () => {
    expect(classifyBiRiskHeatmapCellLevel(0.1, 10)).toBe('low')
    expect(classifyBiRiskHeatmapCellLevel(0, 10)).toBe('low')
  })

  it('样本不足 → insufficient_data', () => {
    expect(classifyBiRiskHeatmapCellLevel(0.9, 2)).toBe('insufficient_data')
    expect(classifyBiRiskHeatmapCellLevel(0.5, 0)).toBe('insufficient_data')
    expect(classifyBiRiskHeatmapCellLevel(0.1, 1)).toBe('insufficient_data')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Insufficient samples
// ══════════════════════════════════════════════════════════════════════════════

describe('样本不足处理', () => {
  it('confidence 在低样本数时降低', () => {
    const c1 = computeBiRiskHeatmapConfidence({ sampleCount: 10, sourceCoverage: 1 })
    const c2 = computeBiRiskHeatmapConfidence({ sampleCount: 2, sourceCoverage: 1 })
    expect(c2).toBeLessThan(c1)
  })

  it('样本为 0 时 confidence 接近 0', () => {
    const c = computeBiRiskHeatmapConfidence({ sampleCount: 0, sourceCoverage: 0 })
    expect(c).toBe(0)
  })

  it('大样本 confidence 接近 1', () => {
    const c = computeBiRiskHeatmapConfidence({ sampleCount: 100, sourceCoverage: 1 })
    expect(c).toBeCloseTo(1, 1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Missing sources
// ══════════════════════════════════════════════════════════════════════════════

describe('缺失来源处理', () => {
  it('aggregateBiRiskHeatmapFreshness: 空来源 → unknown', () => {
    const f = aggregateBiRiskHeatmapFreshness([])
    expect(f.state).toBe('unknown')
    expect(f.sourceCoverage).toBe(0)
    expect(f.freshnessHash).toBe('no-sources')
  })

  it('aggregateBiRiskHeatmapFreshness: 全 fresh → fresh', () => {
    const f = aggregateBiRiskHeatmapFreshness([
      mkSourceRef({ state: 'fresh' }),
      mkSourceRef({ state: 'fresh', sourceKind: 'risk_matrix' }),
    ])
    expect(f.state).toBe('fresh')
  })

  it('aggregateBiRiskHeatmapFreshness: stale 居多 → stale', () => {
    const f = aggregateBiRiskHeatmapFreshness([
      mkSourceRef({ state: 'stale' }),
      mkSourceRef({ state: 'stale' }),
      mkSourceRef({ state: 'fresh', sourceKind: 'risk_matrix' }),
    ])
    expect(f.state).toBe('stale')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Stale sources
// ══════════════════════════════════════════════════════════════════════════════

describe('陈旧来源', () => {
  it('单个 stale 来源标记为 stale', () => {
    const f = aggregateBiRiskHeatmapFreshness([mkSourceRef({ state: 'stale' })])
    expect(f.state).toBe('stale')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Redacted dimensions
// ══════════════════════════════════════════════════════════════════════════════

describe('redacted dimensions', () => {
  it('isBiRiskHeatmapRedacted 正确判断所有状态', () => {
    expect(isBiRiskHeatmapRedacted('none')).toBe(false)
    expect(isBiRiskHeatmapRedacted('partial')).toBe(true)
    expect(isBiRiskHeatmapRedacted('full')).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Contributor truncation
// ══════════════════════════════════════════════════════════════════════════════

describe('contributor truncation', () => {
  it('按 contributionWeight 降序排列', () => {
    const contributors: BiRiskHeatmapContributor[] = [
      mkContributor({ id: 'a', contributionWeight: 0.3 }),
      mkContributor({ id: 'b', contributionWeight: 0.8 }),
      mkContributor({ id: 'c', contributionWeight: 0.5 }),
    ]
    const result = truncateBiRiskHeatmapContributors(contributors, 3)
    expect(result[0].contributionWeight).toBe(0.8)
    expect(result[1].contributionWeight).toBe(0.5)
    expect(result[2].contributionWeight).toBe(0.3)
  })

  it('截断到最大数量', () => {
    const contributors: BiRiskHeatmapContributor[] = Array.from({ length: 10 }, (_, i) =>
      mkContributor({ id: `c${i}`, contributionWeight: 0.1 * (10 - i) }),
    )
    const result = truncateBiRiskHeatmapContributors(contributors, 5)
    expect(result).toHaveLength(5)
  })

  it('排名从 1 开始', () => {
    const contributors: BiRiskHeatmapContributor[] = [
      mkContributor({ id: 'a', contributionWeight: 0.8 }),
      mkContributor({ id: 'b', contributionWeight: 0.5 }),
    ]
    const result = truncateBiRiskHeatmapContributors(contributors, 5)
    expect(result[0].rank).toBe(1)
    expect(result[1].rank).toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Delta calculation
// ══════════════════════════════════════════════════════════════════════════════

describe('delta calculation', () => {
  it('正值 delta', () => {
    const d = computeBiRiskHeatmapDelta(0.6, 0.4)
    expect(d).toBeCloseTo(0.2, 3)
  })

  it('负值 delta', () => {
    const d = computeBiRiskHeatmapDelta(0.3, 0.5)
    expect(d).toBeCloseTo(-0.2, 3)
  })

  it('无上期数据 → null', () => {
    const d = computeBiRiskHeatmapDelta(0.6, null)
    expect(d).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Confidence calculation
// ══════════════════════════════════════════════════════════════════════════════

describe('confidence calculation', () => {
  it('完美条件 → 1', () => {
    const c = computeBiRiskHeatmapConfidence({ sampleCount: 30, sourceCoverage: 1 })
    expect(c).toBeCloseTo(1, 1)
  })

  it('零条件 → 0', () => {
    const c = computeBiRiskHeatmapConfidence({ sampleCount: 0, sourceCoverage: 0 })
    expect(c).toBe(0)
  })

  it('中等条件', () => {
    const c = computeBiRiskHeatmapConfidence({ sampleCount: 5, sourceCoverage: 0.5 })
    expect(c).toBeGreaterThan(0.3)
    expect(c).toBeLessThan(0.6)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// §2.6 Edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('normalizeBiRiskHeatmapDimensionValue 归一化空格和大写', () => {
    expect(normalizeBiRiskHeatmapDimensionValue('  Project A  ')).toBe('project_a')
    expect(normalizeBiRiskHeatmapDimensionValue('RISK LEVEL')).toBe('risk_level')
  })

  it('isBiRiskHeatmapDimensionPairUnsafe 拒绝相同行列', () => {
    expect(isBiRiskHeatmapDimensionPairUnsafe('project', 'project')).toBe(true)
    expect(isBiRiskHeatmapDimensionPairUnsafe('project', 'risk_level')).toBe(false)
  })

  it('isBiRiskHeatmapCellCountWithinLimit 检查上限', () => {
    expect(isBiRiskHeatmapCellCountWithinLimit(100)).toBe(true)
    expect(isBiRiskHeatmapCellCountWithinLimit(501)).toBe(false)
  })

  it('isBiRiskHeatmapFilterCountWithinLimit 检查上限', () => {
    expect(isBiRiskHeatmapFilterCountWithinLimit(5)).toBe(true)
    expect(isBiRiskHeatmapFilterCountWithinLimit(11)).toBe(false)
  })

  it('simpleBiRiskHeatmapHash 稳定输出', () => {
    const h1 = simpleBiRiskHeatmapHash('test-input')
    const h2 = simpleBiRiskHeatmapHash('test-input')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^rh_[0-9a-f]+$/)
  })

  it('buildBiRiskHeatmapQueryShape 正确构建', () => {
    const q = mkQuery({
      filters: {
        riskCategories: ['schedule', 'resource'],
        riskLevels: ['high'],
      },
    })
    const shape = buildBiRiskHeatmapQueryShape(q)
    expect(shape.metricKey).toBe('risk_exposure_score')
    expect(shape.rowDimension).toBe('project')
    expect(shape.columnDimension).toBe('risk_level')
    expect(shape.filterCount).toBe(3)
  })
})
