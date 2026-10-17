/**
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.6 —— 缺口分析适配层纯函数单测。
 *
 * 覆盖：URL 状态解析/序列化白名单与非法回落、五维切换、严重度色阶全覆盖
 * （DOM 令牌 + ECharts 十六进制双通道）、图表数据点模型（排序/脱敏剔除/数值
 * 取整）、缺口小时格式化。全部零 DOM、零网络。
 */
import { describe, expect, test } from 'vitest'
import {
  buildGapBarModel,
  formatGapHours,
  GAP_DEFAULT_DIMENSION,
  GAP_DEFAULT_GRANULARITY,
  GAP_DEFAULT_TOP_N,
  GAP_DIMENSION_LABELS,
  GAP_DIMENSION_TABS,
  GAP_METRIC_LABELS,
  GAP_SEVERITY_HEX,
  GAP_SEVERITY_LABELS,
  GAP_SEVERITY_TONES,
  GAP_TOP_N_OPTIONS,
  gapUrlStateToQuery,
  getGapSeverityHex,
  getGapSeverityLabel,
  getGapSeverityTone,
  getGapDimensionTabLabel,
  parseGapUrlState,
  serializeGapUrlState,
  type GapUrlState,
  type ResourceGapDimension,
  type ResourceGapEntry,
  type ResourceGapSeverity,
} from '@/lib/next/org-gaps/org-gaps-adapter'

// ---------------------------------------------------------------------------
// 维度与标签
// ---------------------------------------------------------------------------

describe('维度 Tab 与标签（角色/技能/时段/项目/组合）', () => {
  test('五维切换顺序与中文标签', () => {
    expect(GAP_DIMENSION_TABS).toEqual([
      { key: 'role', label: '角色' },
      { key: 'skill', label: '技能' },
      { key: 'timeBucket', label: '时段' },
      { key: 'project', label: '项目' },
      { key: 'portfolio', label: '组合' },
    ])
    expect(getGapDimensionTabLabel('role')).toBe('角色')
    expect(getGapDimensionTabLabel('portfolio')).toBe('组合')
    expect(GAP_DIMENSION_LABELS.skill).toBe('技能')
    expect(GAP_METRIC_LABELS.allocated_vs_demand).toBe('已分配 vs 需求')
    expect(GAP_SEVERITY_LABELS.critical).toBe('严重')
  })

  test('严重度标签与色阶全覆盖（令牌 + 十六进制双通道）', () => {
    const severities: ResourceGapSeverity[] = ['critical', 'high', 'medium', 'low', 'none']
    for (const severity of severities) {
      expect(getGapSeverityLabel(severity)).toBe(GAP_SEVERITY_LABELS[severity])
      const tone = getGapSeverityTone(severity)
      expect(tone).toBe(GAP_SEVERITY_TONES[severity])
      expect(tone.startsWith('--nx-')).toBe(true)
      const hex = getGapSeverityHex(severity)
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      expect(hex).toBe(GAP_SEVERITY_HEX[severity])
    }
    expect(GAP_SEVERITY_TONES.critical).toBe('--nx-status-danger')
    expect(GAP_SEVERITY_HEX.critical).toBe('#ef4444')
    expect(GAP_SEVERITY_HEX.low).toBe('#38bdf8')
  })
})

// ---------------------------------------------------------------------------
// URL 状态序列化 / 解析
// ---------------------------------------------------------------------------

function makeSearch(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values)
}

describe('URL 状态解析与序列化（restorable filters）', () => {
  test('默认值：dimension=skill、metric/severity 空、topN 10、粒度 iso_week', () => {
    const state = parseGapUrlState(new URLSearchParams())
    expect(state).toEqual({
      dimension: 'skill',
      metric: null,
      severity: null,
      topN: 10,
      granularity: 'iso_week',
    })
    expect(GAP_DEFAULT_DIMENSION).toBe('skill')
    expect(GAP_DEFAULT_TOP_N).toBe(10)
    expect(GAP_DEFAULT_GRANULARITY).toBe('iso_week')
  })

  test('合法参数完整解析', () => {
    const state = parseGapUrlState(
      makeSearch({
        dimension: 'role',
        metric: 'skill_shortfall',
        severity: 'high',
        topN: '20',
        granularity: 'month',
      }),
    )
    expect(state).toEqual({
      dimension: 'role',
      metric: 'skill_shortfall',
      severity: 'high',
      topN: 20,
      granularity: 'month',
    })
  })

  test('非法维度/粒度/严重度回落默认（白名单收敛）', () => {
    const state = parseGapUrlState(
      makeSearch({
        dimension: 'bogus',
        metric: 'nope',
        severity: 'extreme',
        granularity: 'hourly',
        topN: 'abc',
      }),
    )
    expect(state.dimension).toBe('skill')
    expect(state.metric).toBeNull()
    expect(state.severity).toBeNull()
    expect(state.granularity).toBe('iso_week')
    expect(state.topN).toBe(10)
  })

  test('topN 边界 clamp 5–50', () => {
    expect(parseGapUrlState(makeSearch({ topN: '1' })).topN).toBe(5)
    expect(parseGapUrlState(makeSearch({ topN: '999' })).topN).toBe(50)
    expect(parseGapUrlState(makeSearch({ topN: '7' })).topN).toBe(7)
  })

  test('序列化仅写非默认值且 dimension 恒写', () => {
    expect(serializeGapUrlState(parseGapUrlState(new URLSearchParams()))).toEqual({
      dimension: 'skill',
    })
    const state: GapUrlState = {
      dimension: 'project',
      metric: 'forecast_gap',
      severity: null,
      topN: 20,
      granularity: 'iso_week',
    }
    expect(serializeGapUrlState(state)).toEqual({
      dimension: 'project',
      metric: 'forecast_gap',
      topN: '20',
    })
  })

  test('roundtrip：序列化 → 解析保持状态一致', () => {
    const original: GapUrlState = {
      dimension: 'timeBucket',
      metric: 'available_vs_demand',
      severity: 'critical',
      topN: 50,
      granularity: 'month',
    }
    const params = new URLSearchParams(serializeGapUrlState(original))
    expect(parseGapUrlState(params)).toEqual(original)
  })

  test('toResourceGapQuery 收敛既有 hook 查询形状', () => {
    const state: GapUrlState = {
      dimension: 'role',
      metric: 'skill_shortfall',
      severity: 'high',
      topN: 20,
      granularity: 'month',
    }
    expect(gapUrlStateToQuery(state)).toEqual({
      metrics: ['skill_shortfall'],
      severity: 'high',
      topN: 20,
      timeBucketGranularity: 'month',
    })
    expect(gapUrlStateToQuery(parseGapUrlState(new URLSearchParams()))).toEqual({
      metrics: undefined,
      severity: undefined,
      topN: 10,
      timeBucketGranularity: 'iso_week',
    })
  })

  test('Top N 选项固定', () => {
    expect(GAP_TOP_N_OPTIONS.map((option) => option.value)).toEqual([5, 10, 20, 50])
  })
})

// ---------------------------------------------------------------------------
// 图表数据点纯函数
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ResourceGapEntry>): ResourceGapEntry {
  return {
    gapId: `gap-${Math.random()}`,
    dimension: 'skill',
    dimensionValue: '前端开发',
    dimensionLabel: '前端开发',
    metric: 'allocated_vs_demand',
    severity: 'high',
    demandHours: 200,
    supplyHours: 120,
    gapHours: 80,
    gapRatio: 0.4,
    dateWindow: null,
    reasons: [],
    warnings: [],
    redacted: false,
    ...overrides,
  }
}

describe('buildGapBarModel 图表行模型', () => {
  test('按缺口小时降序映射数据点', () => {
    const model = buildGapBarModel([
      makeEntry({
        gapId: 'a',
        dimensionLabel: '低缺口',
        gapHours: 10,
        gapRatio: 0.1,
        severity: 'low',
      }),
      makeEntry({
        gapId: 'b',
        dimensionLabel: '高缺口',
        gapHours: 120,
        gapRatio: 0.9,
        severity: 'critical',
      }),
    ])
    expect(model.categories).toEqual(['高缺口', '低缺口'])
    expect(model.gapHours).toEqual([120, 10])
    expect(model.demandHours).toEqual([200, 200])
    expect(model.supplyHours).toEqual([120, 120])
    expect(model.severities).toEqual(['critical', 'low'])
    expect(model.gapRatios).toEqual([0.9, 0.1])
  })

  test('redacted 条目不入图（不泄露维度身份）', () => {
    const model = buildGapBarModel([
      makeEntry({ gapId: 'r', dimensionLabel: '隐藏项', redacted: true, gapHours: 500 }),
      makeEntry({ gapId: 'o', dimensionLabel: '可见项', gapHours: 30, severity: 'medium' }),
    ])
    expect(model.categories).toEqual(['可见项'])
    expect(model.gapHours).toEqual([30])
  })

  test('空输入安全返回空模型', () => {
    expect(buildGapBarModel([])).toEqual({
      categories: [],
      demandHours: [],
      supplyHours: [],
      gapHours: [],
      severities: [],
      gapRatios: [],
    })
  })

  test('数值保留两位小数', () => {
    const model = buildGapBarModel([
      makeEntry({
        gapId: 'x',
        dimensionLabel: 'X',
        gapHours: 80.555,
        demandHours: 200.123,
        gapRatio: 0.4026,
      }),
    ])
    expect(model.gapHours).toEqual([80.56])
    expect(model.demandHours).toEqual([200.12])
    expect(model.gapRatios).toEqual([0.4])
  })
})

describe('formatGapHours', () => {
  test('小时格式化保留 1 位小数', () => {
    expect(formatGapHours(0)).toBe('0.0h')
    expect(formatGapHours(80)).toBe('80.0h')
    expect(formatGapHours(80.56)).toBe('80.6h')
    expect(formatGapHours(Number.NaN)).toBe('—')
  })
})

describe('缺口维度类型（内部引用完整性）', () => {
  test('organization 维不在五维切换内但标签表含全量', () => {
    const tabKeys: ResourceGapDimension[] = GAP_DIMENSION_TABS.map((tab) => tab.key)
    expect(tabKeys.includes('organization')).toBe(false)
    expect(GAP_DIMENSION_LABELS.organization).toBe('组织')
  })
})
