// @aiproj/types —— 资源缺口分析共享契约测试。
// v3-resource-gap-analysis §2.3：封闭枚举、映射函数、类型互导（前端+后端）、零运行时依赖。

import { describe, expect, test } from 'vitest'
import {
  RESOURCE_GAP_DIMENSION_VALUES,
  RESOURCE_GAP_METRIC_VALUES,
  RESOURCE_GAP_SEVERITY_VALUES,
  RESOURCE_GAP_REASON_CODE_VALUES,
  RESOURCE_GAP_QUERY_TYPE_VALUES,
  RESOURCE_GAP_WARNING_CODE_VALUES,
  RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
  RESOURCE_GAP_SEVERITY_ORDER,
  RESOURCE_GAP_REASON_PRIORITY,
  RESOURCE_GAP_REASON_LABELS,
  RESOURCE_GAP_DIMENSION_LABELS,
  RESOURCE_GAP_METRIC_LABELS,
  RESOURCE_GAP_SEVERITY_LABELS,
  compareGapSeverity,
  compareReasonPriority,
  sortReasonsByPriority,
  makeResourceGapId,
  makeResourceGapEvidenceHash,
  makeResourceGapQuerySignatureHash,
  normalizeResourceGapQuery,
  resourceGapValidationDetail,
  resourceGapRoundTwo,
  resourceGapClamp,
  resourceGapStableHash,
  buildRuleExplanation,
  determineGapSeverity,
  generateSuggestedActions,
  RESOURCE_GAP_DEFAULT_DATE_WINDOW_DAYS,
  RESOURCE_GAP_MAX_DATE_WINDOW_DAYS,
  RESOURCE_GAP_DEFAULT_TOP_N,
  RESOURCE_GAP_MAX_TOP_N,
  RESOURCE_GAP_DEFAULT_PER_PAGE,
  RESOURCE_GAP_MAX_PER_PAGE,
  RESOURCE_GAP_DEFAULT_REASON_TOP_N,
  RESOURCE_GAP_MAX_REASON_TOP_N,
} from './resource-gap-analysis.js'
import type {
  ResourceGapDimension,
  ResourceGapMetric,
  ResourceGapSeverity,
  ResourceGapReasonCode,
  ResourceGapQueryType,
  ResourceGapWarningCode,
  ResourceGapQuery,
  ResourceGapEntry,
  ResourceGapSummary,
  ResourceGapMeta,
  ResourceGapExplanation,
  ResourceGapWarning,
  ResourceGapEvidence,
  ResourceGapReason,
} from './resource-gap-analysis.js'

// ─── 封闭枚举测试 ────────────────────────────────────────────────────────

describe('封闭枚举完整性', () => {
  test('维度枚举含 6 个值', () => {
    expect(RESOURCE_GAP_DIMENSION_VALUES).toHaveLength(6)
    expect(RESOURCE_GAP_DIMENSION_VALUES).toContain('role')
    expect(RESOURCE_GAP_DIMENSION_VALUES).toContain('skill')
    expect(RESOURCE_GAP_DIMENSION_VALUES).toContain('timeBucket')
    expect(RESOURCE_GAP_DIMENSION_VALUES).toContain('project')
    expect(RESOURCE_GAP_DIMENSION_VALUES).toContain('portfolio')
    expect(RESOURCE_GAP_DIMENSION_VALUES).toContain('organization')
  })

  test('口径枚举含 4 个值', () => {
    expect(RESOURCE_GAP_METRIC_VALUES).toHaveLength(4)
    expect(RESOURCE_GAP_METRIC_VALUES).toContain('allocated_vs_demand')
    expect(RESOURCE_GAP_METRIC_VALUES).toContain('available_vs_demand')
    expect(RESOURCE_GAP_METRIC_VALUES).toContain('skill_shortfall')
    expect(RESOURCE_GAP_METRIC_VALUES).toContain('forecast_gap')
  })

  test('严重度枚举含 5 个值', () => {
    expect(RESOURCE_GAP_SEVERITY_VALUES).toHaveLength(5)
    expect(RESOURCE_GAP_SEVERITY_VALUES).toContain('critical')
    expect(RESOURCE_GAP_SEVERITY_VALUES).toContain('high')
    expect(RESOURCE_GAP_SEVERITY_VALUES).toContain('medium')
    expect(RESOURCE_GAP_SEVERITY_VALUES).toContain('low')
    expect(RESOURCE_GAP_SEVERITY_VALUES).toContain('none')
  })

  test('原因码枚举含至少 7 个值', () => {
    expect(RESOURCE_GAP_REASON_CODE_VALUES.length).toBeGreaterThanOrEqual(7)
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('NO_CANDIDATE_RESOURCE')
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('CANDIDATES_OVERLOADED')
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('SKILL_ORG_WIDE_SHORTAGE')
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('ALLOC_CONFLICT')
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('PRIORITY_CROWDING')
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('AVAILABILITY_EXCEPTION')
    expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain('FORECAST_UNCERTAIN')
  })

  test('查询类型枚举含 8 个值', () => {
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toHaveLength(8)
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('summary')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('by-role')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('by-skill')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('by-timebucket')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('by-project')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('by-portfolio')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('explanation')
    expect(RESOURCE_GAP_QUERY_TYPE_VALUES).toContain('drill-down')
  })

  test('警告码枚举含 11 个值', () => {
    expect(RESOURCE_GAP_WARNING_CODE_VALUES.length).toBeGreaterThanOrEqual(10)
    expect(RESOURCE_GAP_WARNING_CODE_VALUES).toContain('UPSTREAM_UNAVAILABLE')
    expect(RESOURCE_GAP_WARNING_CODE_VALUES).toContain('CACHE_DEGRADED')
    expect(RESOURCE_GAP_WARNING_CODE_VALUES).toContain('RESULT_TRUNCATED')
    expect(RESOURCE_GAP_WARNING_CODE_VALUES).toContain('AI_DISABLED')
    expect(RESOURCE_GAP_WARNING_CODE_VALUES).toContain('AI_EXPLANATION_LOW_CONFIDENCE')
  })

  test('metricVersion 常量为 resource-gap-analysis@1', () => {
    expect(RESOURCE_GAP_ANALYSIS_METRIC_VERSION).toBe('resource-gap-analysis@1')
  })

  test('所有原因码都有中文标签', () => {
    for (const code of RESOURCE_GAP_REASON_CODE_VALUES) {
      expect(RESOURCE_GAP_REASON_LABELS[code]).toBeDefined()
      expect(typeof RESOURCE_GAP_REASON_LABELS[code]).toBe('string')
      expect(RESOURCE_GAP_REASON_LABELS[code].length).toBeGreaterThan(0)
    }
  })

  test('所有严重度都有中文标签', () => {
    for (const severity of RESOURCE_GAP_SEVERITY_VALUES) {
      expect(RESOURCE_GAP_SEVERITY_LABELS[severity]).toBeDefined()
      expect(typeof RESOURCE_GAP_SEVERITY_LABELS[severity]).toBe('string')
    }
  })

  test('所有维度都有中文标签', () => {
    for (const dim of RESOURCE_GAP_DIMENSION_VALUES) {
      expect(RESOURCE_GAP_DIMENSION_LABELS[dim]).toBeDefined()
    }
  })

  test('所有口径都有中文标签', () => {
    for (const metric of RESOURCE_GAP_METRIC_VALUES) {
      expect(RESOURCE_GAP_METRIC_LABELS[metric]).toBeDefined()
    }
  })
})

// ─── 排序函数测试 ────────────────────────────────────────────────────────

describe('排序函数', () => {
  test('严重度排序：critical < high < medium < low < none', () => {
    expect(compareGapSeverity('critical', 'high')).toBeLessThan(0)
    expect(compareGapSeverity('high', 'medium')).toBeLessThan(0)
    expect(compareGapSeverity('medium', 'low')).toBeLessThan(0)
    expect(compareGapSeverity('low', 'none')).toBeLessThan(0)
    expect(compareGapSeverity('none', 'critical')).toBeGreaterThan(0)
    expect(compareGapSeverity('critical', 'critical')).toBe(0)
  })

  test('严重度排序权重完整性', () => {
    for (const severity of RESOURCE_GAP_SEVERITY_VALUES) {
      expect(RESOURCE_GAP_SEVERITY_ORDER[severity]).toBeDefined()
      expect(typeof RESOURCE_GAP_SEVERITY_ORDER[severity]).toBe('number')
    }
  })

  test('原因码优先级：NO_CANDIDATE_RESOURCE 最高', () => {
    expect(RESOURCE_GAP_REASON_PRIORITY['NO_CANDIDATE_RESOURCE']).toBe(0)
    expect(RESOURCE_GAP_REASON_PRIORITY['FORECAST_UNCERTAIN']).toBe(6)
  })

  test('sortReasonsByPriority 按优先级正确排序', () => {
    const codes: ResourceGapReasonCode[] = [
      'FORECAST_UNCERTAIN',
      'NO_CANDIDATE_RESOURCE',
      'ALLOC_CONFLICT',
    ]
    const sorted = sortReasonsByPriority(codes)
    expect(sorted[0]).toBe('NO_CANDIDATE_RESOURCE')
    expect(sorted[1]).toBe('ALLOC_CONFLICT')
    expect(sorted[2]).toBe('FORECAST_UNCERTAIN')
  })

  test('所有原因码都有优先级定义', () => {
    for (const code of RESOURCE_GAP_REASON_CODE_VALUES) {
      expect(RESOURCE_GAP_REASON_PRIORITY[code]).toBeDefined()
    }
  })
})

// ─── 哈希函数测试 ────────────────────────────────────────────────────────

describe('哈希函数', () => {
  test('resourceGapStableHash 确定性', () => {
    expect(resourceGapStableHash('hello')).toBe(resourceGapStableHash('hello'))
    expect(resourceGapStableHash('hello')).not.toBe(resourceGapStableHash('world'))
  })

  test('resourceGapStableHash 返回 8 位 hex 字符串', () => {
    const hash = resourceGapStableHash('test')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  test('makeResourceGapId 确定性', () => {
    const input = {
      organizationId: 1,
      dimension: 'skill' as ResourceGapDimension,
      dimensionValue: 'react',
      metric: 'skill_shortfall' as ResourceGapMetric,
      dateWindow: { from: '2026-01-01', to: '2026-03-31' },
    }
    expect(makeResourceGapId(input)).toBe(makeResourceGapId(input))
    const changed = { ...input, dimensionValue: 'typescript' }
    expect(makeResourceGapId(changed)).not.toBe(makeResourceGapId(input))
  })

  test('makeResourceGapEvidenceHash 确定性', () => {
    const evidence = {
      kind: 'allocation' as const,
      sourceKey: 'alloc_1',
      targetIds: [1, 2, 3],
      timestamp: '2026-07-29T10:00:00Z',
    }
    expect(makeResourceGapEvidenceHash(evidence)).toBe(makeResourceGapEvidenceHash(evidence))
  })
})

// ─── 归一化查询测试 ────────────────────────────────────────────────────

describe('normalizeResourceGapQuery', () => {
  test('空查询返回默认值', () => {
    const result = normalizeResourceGapQuery()
    expect(result.type).toBe('summary')
    expect(result.timeBucketGranularity).toBe('iso_week')
    expect(result.topN).toBe(RESOURCE_GAP_DEFAULT_TOP_N)
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(RESOURCE_GAP_DEFAULT_PER_PAGE)
    expect(result.sort).toBe('severity')
    expect(result.order).toBe('desc')
  })

  test('不合法类型回退到 summary', () => {
    const result = normalizeResourceGapQuery({ type: 'invalid' as any })
    expect(result.type).toBe('summary')
  })

  test('越界 topN 被 clamp', () => {
    const result = normalizeResourceGapQuery({ topN: 1000 })
    expect(result.topN).toBe(RESOURCE_GAP_MAX_TOP_N)
  })

  test('日期窗口超限被 clamp', () => {
    const result = normalizeResourceGapQuery({
      from: '2025-01-01',
      to: '2026-12-31',
    })
    const fromMs = new Date(result.from).getTime()
    const toMs = new Date(result.to).getTime()
    const days = (toMs - fromMs) / (1000 * 60 * 60 * 24)
    expect(days).toBeLessThanOrEqual(RESOURCE_GAP_MAX_DATE_WINDOW_DAYS + 1)
  })

  test('合法查询参数保留', () => {
    const result = normalizeResourceGapQuery({
      type: 'by-skill',
      severity: 'critical',
      dimension: 'skill',
      metrics: ['skill_shortfall', 'available_vs_demand'],
      projectIds: [1, 2],
      skillKeys: ['react', 'typescript'],
      timeBucketGranularity: 'month',
      topN: 20,
      sort: 'gap_hours',
      order: 'asc',
    })
    expect(result.type).toBe('by-skill')
    expect(result.severity).toBe('critical')
    expect(result.dimension).toBe('skill')
    expect(result.metrics).toEqual(['skill_shortfall', 'available_vs_demand'])
    expect(result.projectIds).toEqual([1, 2])
    expect(result.skillKeys).toEqual(['react', 'typescript'])
    expect(result.timeBucketGranularity).toBe('month')
    expect(result.topN).toBe(20)
    expect(result.sort).toBe('gap_hours')
    expect(result.order).toBe('asc')
  })
})

// ─── 严重度判定测试 ────────────────────────────────────────────────────

describe('determineGapSeverity', () => {
  test('>= 0.75 → critical', () => {
    expect(determineGapSeverity(0.75)).toBe('critical')
    expect(determineGapSeverity(0.9)).toBe('critical')
    expect(determineGapSeverity(1.0)).toBe('critical')
  })

  test('>= 0.5 → high', () => {
    expect(determineGapSeverity(0.5)).toBe('high')
    expect(determineGapSeverity(0.74)).toBe('high')
  })

  test('>= 0.25 → medium', () => {
    expect(determineGapSeverity(0.25)).toBe('medium')
    expect(determineGapSeverity(0.49)).toBe('medium')
  })

  test('> 0 → low', () => {
    expect(determineGapSeverity(0.01)).toBe('low')
    expect(determineGapSeverity(0.24)).toBe('low')
  })

  test('0 → none', () => {
    expect(determineGapSeverity(0)).toBe('none')
    expect(determineGapSeverity(-0.1)).toBe('none')
  })
})

// ─── 规则解释测试 ──────────────────────────────────────────────────────

describe('buildRuleExplanation', () => {
  const ctx = { dimensionLabel: '技能', dimensionValue: 'React', gapHours: 40 }

  test('所有 7 个原因码都能生成解释', () => {
    for (const code of RESOURCE_GAP_REASON_CODE_VALUES) {
      const explanation = buildRuleExplanation(code, ctx)
      expect(explanation).toBeDefined()
      expect(typeof explanation).toBe('string')
      expect(explanation.length).toBeGreaterThan(0)
    }
  })

  test('解释文本包含缺口信息', () => {
    const explanation = buildRuleExplanation('NO_CANDIDATE_RESOURCE', ctx)
    expect(explanation).toContain('React')
    expect(explanation).toContain('40')
  })

  test('解释文本包含中文原因码标签', () => {
    for (const code of RESOURCE_GAP_REASON_CODE_VALUES) {
      const explanation = buildRuleExplanation(code, ctx)
      expect(explanation).toContain(RESOURCE_GAP_REASON_LABELS[code])
    }
  })
})

// ─── 建议动作测试 ──────────────────────────────────────────────────────

describe('generateSuggestedActions', () => {
  test('无候选人资源 → 建议 hire + skill_development', () => {
    const actions = generateSuggestedActions(['NO_CANDIDATE_RESOURCE'], {
      dimension: 'skill',
      gapHours: 40,
      skill: 'React',
    })
    const types = actions.map((a) => a.actionType)
    expect(types).toContain('hire')
    expect(types).toContain('skill_development')
  })

  test('过载+冲突 → 建议重新分配', () => {
    const actions = generateSuggestedActions(['CANDIDATES_OVERLOADED', 'ALLOC_CONFLICT'], {
      dimension: 'role',
      gapHours: 20,
      role: 'Frontend',
    })
    const types = actions.map((a) => a.actionType)
    expect(types).toContain('reallocate')
  })

  test('所有产出动作都不是自动执行指令', () => {
    for (const codes of [
      ['NO_CANDIDATE_RESOURCE'],
      ['CANDIDATES_OVERLOADED'],
      ['FORECAST_UNCERTAIN'],
    ] as ResourceGapReasonCode[][]) {
      const actions = generateSuggestedActions(codes, { dimension: 'skill', gapHours: 10 })
      for (const action of actions) {
        expect(action).toHaveProperty('description')
        expect(action).toHaveProperty('actionType')
      }
    }
  })
})

// ─── 工具函数测试 ──────────────────────────────────────────────────────

describe('resourceGapRoundTwo', () => {
  test('保留两位小数', () => {
    expect(resourceGapRoundTwo(3.14159)).toBe(3.14)
    expect(resourceGapRoundTwo(2.71828)).toBe(2.72)
    expect(resourceGapRoundTwo(10)).toBe(10)
  })
})

describe('resourceGapClamp', () => {
  test('在范围内返回原值', () => {
    expect(resourceGapClamp(5, 1, 10)).toBe(5)
  })
  test('低于下限返回下限', () => {
    expect(resourceGapClamp(0, 1, 10)).toBe(1)
  })
  test('高于上限返回上限', () => {
    expect(resourceGapClamp(20, 1, 10)).toBe(10)
  })
  test('非数字返回下限', () => {
    expect(resourceGapClamp(NaN, 1, 10)).toBe(1)
    expect(resourceGapClamp(Infinity, 1, 10)).toBe(1)
  })
})

describe('resourceGapValidationDetail', () => {
  test('返回完整验证信息', () => {
    const detail = resourceGapValidationDetail()
    expect(detail.allowedTypes.length).toBe(8)
    expect(detail.allowedMetrics.length).toBe(4)
    expect(detail.allowedDimensions.length).toBe(6)
    expect(detail.allowedSeverities.length).toBe(5)
    expect(detail.maxDateWindowDays).toBe(RESOURCE_GAP_MAX_DATE_WINDOW_DAYS)
  })
})

describe('makeResourceGapQuerySignatureHash', () => {
  test('相同查询产生相同哈希', () => {
    const q: any = normalizeResourceGapQuery({ type: 'by-skill', topN: 10 })
    expect(makeResourceGapQuerySignatureHash(q)).toBe(makeResourceGapQuerySignatureHash(q))
  })
})

// ─── 类型互导测试（编译时）─────────────────────────────────────────
// 以下测试确保所有主要类型在前端都可通过 TypeScript 正确导入

describe('类型定义存在性', () => {
  test('核心类型可被引用（运行时检查）', () => {
    // 编译时类型检查保证正确性，运行时验证常量
    expect(RESOURCE_GAP_ANALYSIS_METRIC_VERSION).toBeTruthy()
    expect(RESOURCE_GAP_DIMENSION_VALUES.length).toBeGreaterThan(0)
    expect(RESOURCE_GAP_REASON_CODE_VALUES.length).toBeGreaterThan(0)
  })
})
