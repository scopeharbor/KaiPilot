/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.6 —— 需求预测适配器纯函数单元测试。
 *
 * 覆盖：demand-curves 点序列化（按 bucketStart 聚合）、驱动（项目/技能）标签与
 * 数值格式化（含受限中性化）、gap-analysis 桶格式化与瀑布聚合、置信度/告警码/
 * 缺口类型标签色阶、URL 状态解析/序列化（restorable filters）、指标 KPI 格式化；
 * 零 DOM 高速单测。
 */
import { describe, expect, test } from 'vitest'
import {
  aggregateDemandDimensionRows,
  buildGapWaterfall,
  confidenceMetaOf,
  createDefaultForecastWindow,
  DEMAND_CONFIDENCE_LABELS,
  DEMAND_CONFIDENCE_META,
  DEMAND_GRANULARITY_LABELS,
  DEMAND_METHOD_LABELS,
  demandMetricLabel,
  demandUrlStateToQuery,
  demandWarningChipClass,
  demandWarningLabel,
  formatDemandHours,
  formatDemandMetric,
  formatDemandPercentRatio,
  formatForecastDate,
  formatForecastWindow,
  formatGapAnalysisTotals,
  formatGapEntryBucket,
  formatGapEntryDimension,
  formatProjectDriverLabel,
  formatSignedGapHours,
  formatSkillDriverLabel,
  gapTypeChipClass,
  gapTypeLabel,
  hasActiveDemandFilters,
  isDemandCurveEmpty,
  isDemandDimensionRedacted,
  parseDemandUrlState,
  serializeDemandUrlState,
  serializeDemandCurveSeries,
  worstConfidence,
} from '@/lib/next/org-demand/org-demand-adapter'
import type {
  ForecastDemandCurve,
  ForecastGapAnalysis,
  ForecastGapEntry,
  ForecastProjectBucket,
  ForecastProjectDriver,
  ForecastRoleBucket,
  ForecastSkillBucket,
  ForecastSkillDriver,
} from '@aiproj/types'

// ─── fixtures ─────────────────────────────────────────────────────────────

function roleBucket(overrides: Partial<ForecastRoleBucket> = {}): ForecastRoleBucket {
  return {
    bucketStart: '2026-09-07',
    bucketEnd: '2026-09-13',
    forecastDemand: 100,
    actualAllocation: 80,
    available: 120,
    remaining: 40,
    gap: 20,
    confidence: 'high',
    method: 'deterministic_bucket',
    sourceFreshness: null,
    warnings: [],
    evidenceRefs: [],
    role: '前端工程师',
    ...overrides,
  }
}

function skillBucket(overrides: Partial<ForecastSkillBucket> = {}): ForecastSkillBucket {
  return {
    bucketStart: '2026-09-07',
    bucketEnd: '2026-09-13',
    forecastDemand: 60,
    actualAllocation: 40,
    available: 80,
    remaining: 40,
    gap: 20,
    confidence: 'medium',
    method: 'deterministic_bucket',
    sourceFreshness: null,
    warnings: [],
    evidenceRefs: [],
    skill: 'react',
    originalLabel: 'React',
    ...overrides,
  }
}

function projectBucket(overrides: Partial<ForecastProjectBucket> = {}): ForecastProjectBucket {
  return {
    bucketStart: '2026-09-07',
    bucketEnd: '2026-09-13',
    forecastDemand: 200,
    actualAllocation: 150,
    available: 240,
    remaining: 90,
    gap: 50,
    confidence: 'low',
    method: 'deterministic_bucket',
    sourceFreshness: null,
    warnings: [],
    evidenceRefs: [],
    projectId: '42',
    projectName: '商城重构',
    ...overrides,
  }
}

function makeCurve(): ForecastDemandCurve {
  return {
    roleBuckets: [
      roleBucket({ role: '前端工程师' }),
      roleBucket({
        bucketStart: '2026-09-14',
        bucketEnd: '2026-09-20',
        forecastDemand: 90,
        actualAllocation: 70,
        gap: 20,
      }),
      roleBucket({ role: '后端工程师', forecastDemand: 60, actualAllocation: 60, gap: 0 }),
    ],
    skillBuckets: [
      skillBucket({}),
      skillBucket({
        bucketStart: '2026-09-14',
        bucketEnd: '2026-09-20',
        forecastDemand: 50,
        gap: 30,
      }),
    ],
    projectBuckets: [projectBucket({})],
    warnings: [],
  }
}

function makeGap(overrides: Partial<ForecastGapEntry> = {}): ForecastGapEntry {
  return {
    gapType: 'shortage',
    description: '前端人力短缺',
    gapHours: 120,
    direction: 'shortage',
    role: '前端工程师',
    skill: undefined,
    projectId: undefined,
    bucketStart: '2026-09-07',
    bucketEnd: '2026-09-13',
    confidence: 'medium',
    warnings: [],
    evidenceRefs: [],
    ...overrides,
  }
}

// ─── 数值/日期格式化 ─────────────────────────────────────────────────────

describe('数值与日期格式化（tasks 5.6）', () => {
  test('工时/占比/计数/带符号缺口格式化', () => {
    expect(formatDemandHours(1204.4)).toBe('1,204h')
    expect(formatDemandHours(null)).toBe('—')
    expect(formatDemandPercentRatio(0.865)).toBe('87%')
    expect(formatDemandPercentRatio(undefined)).toBe('—')
    expect(formatSignedGapHours(120, 'shortage')).toBe('-120h')
    expect(formatSignedGapHours(80, 'surplus')).toBe('+80h')
  })

  test('日期与窗口格式化（UTC 日历日）', () => {
    expect(formatForecastDate('2026-09-07T00:00:00.000Z')).toBe('2026-09-07')
    expect(formatForecastDate('2026-09-07')).toBe('2026-09-07')
    expect(formatForecastDate(null)).toBe('—')
    expect(formatForecastWindow('2026-09-07', '2026-09-20')).toBe('2026-09-07 ~ 2026-09-20')
  })

  test('默认窗口：今天起 12 周（确定性边界）', () => {
    const now = new Date('2026-09-07T08:00:00.000Z')
    const window = createDefaultForecastWindow(now)
    expect(window.startDate).toBe('2026-09-07')
    expect(window.endDate).toBe('2026-11-30')
  })

  test('粒度/方法中文标签', () => {
    expect(DEMAND_GRANULARITY_LABELS).toEqual({ day: '日', week: '周', month: '月' })
    expect(DEMAND_METHOD_LABELS.deterministic_bucket).toBe('确定性分桶')
  })
})

// ─── 置信度/告警码/缺口类型徽标 ─────────────────────────────────────────

describe('置信度/告警码/缺口类型标签与色阶（tasks 5.6）', () => {
  test('四档置信度中文标签齐全，chipClass 为含令牌静态类', () => {
    expect(DEMAND_CONFIDENCE_LABELS).toEqual({
      high: '高',
      medium: '中',
      low: '低',
      unknown: '未知',
    })
    for (const band of ['high', 'medium', 'low', 'unknown'] as const) {
      const meta = DEMAND_CONFIDENCE_META[band]
      expect(meta.label).toBe(DEMAND_CONFIDENCE_LABELS[band])
      expect(meta.chipClass).toContain('var(--nx-')
    }
    expect(confidenceMetaOf('high').chipClass).toContain('var(--nx-status-success)')
    expect(confidenceMetaOf('bogus' as never)).toBe(DEMAND_CONFIDENCE_META.unknown)
    expect(confidenceMetaOf(null)).toBe(DEMAND_CONFIDENCE_META.unknown)
  })

  test('worst 收敛：取最不确定档位', () => {
    expect(worstConfidence(['high', 'medium'])).toBe('medium')
    expect(worstConfidence(['high', 'unknown'])).toBe('unknown')
    expect(worstConfidence(['high', 'low', 'medium'])).toBe('low')
    expect(worstConfidence([])).toBe('unknown')
  })

  test('告警码标签与色阶全覆盖（10 类 FORECAST_WARNING_CODES）', () => {
    expect(demandWarningLabel('INSUFFICIENT_HISTORY')).toBe('历史数据不足')
    expect(demandWarningLabel('STALE_SOURCE')).toBe('源数据过期')
    expect(demandWarningLabel('DIMENSION_REDACTED')).toBe('维度已脱敏')
    expect(demandWarningLabel('NO_PROJECTS_VISIBLE')).toBe('无可视项目')
    expect(demandWarningLabel('NOT_A_CODE' as never)).toBe('NOT_A_CODE')
    expect(demandWarningChipClass('STALE_SOURCE')).toContain('var(--nx-')
  })

  test('缺口类型/方向标签与色阶', () => {
    expect(gapTypeLabel('shortage')).toBe('短缺')
    expect(gapTypeLabel('surplus')).toBe('盈余')
    expect(gapTypeLabel('low_confidence')).toBe('低置信度')
    expect(gapTypeChipClass('shortage')).toContain('var(--nx-status-danger)')
    expect(gapTypeChipClass('surplus')).toContain('var(--nx-status-success)')
    expect(gapTypeLabel('bogus' as never)).toBe('bogus')
  })

  test('KPI 指标标签与格式化（缺口幅值呈现）', () => {
    expect(demandMetricLabel('forecast_total_demand_hours')).toBe('预测总需求')
    expect(formatDemandMetric('forecast_total_demand_hours', 1204.4)).toBe('1,204h')
    expect(formatDemandMetric('forecast_projected_gap_hours', -85)).toBe('85h')
    expect(formatDemandMetric('forecast_visible_project_count', 7)).toBe('7')
    expect(formatDemandMetric('forecast_skill_coverage_ratio', 0.82)).toBe('82%')
  })
})

// ─── demand-curves 点序列化 ──────────────────────────────────────────────

describe('demand-curves 点序列化（tasks 5.6）', () => {
  test('按 bucketStart 聚合各维度桶为曲线点数组（升序去重）', () => {
    const model = serializeDemandCurveSeries(makeCurve(), 'role')
    expect(model.categories).toEqual(['2026-09-07', '2026-09-14'])
    expect(model.forecastDemand).toEqual([160, 90]) // 前端 100 + 后端 60
    expect(model.actualAllocation).toEqual([140, 70])
    expect(model.gap).toEqual([20, 20])
    expect(model.bucketRows).toBe(3)
  })

  test('技能/项目维度独立聚合；空输入安全', () => {
    const skillModel = serializeDemandCurveSeries(makeCurve(), 'skill')
    expect(skillModel.categories).toEqual(['2026-09-07', '2026-09-14'])
    expect(skillModel.forecastDemand).toEqual([60, 50])
    const projectModel = serializeDemandCurveSeries(makeCurve(), 'project')
    expect(projectModel.categories).toEqual(['2026-09-07'])
    expect(projectModel.forecastDemand).toEqual([200])

    const emptyCurve: ForecastDemandCurve = {
      roleBuckets: [],
      skillBuckets: [],
      projectBuckets: [],
      warnings: [],
    }
    const emptyModel = serializeDemandCurveSeries(emptyCurve, 'role')
    expect(emptyModel.categories).toEqual([])
    expect(emptyModel.bucketRows).toBe(0)
    expect(isDemandCurveEmpty(emptyCurve)).toBe(true)
    expect(isDemandCurveEmpty(makeCurve())).toBe(false)
    expect(isDemandCurveEmpty(null)).toBe(true)
  })

  test('维度聚合行模型：按维度分组汇总、受限中性化、峰值桶、worst 置信度', () => {
    const rows = aggregateDemandDimensionRows([
      roleBucket({ role: '前端工程师', roleRedaction: 'forbidden' }),
      roleBucket({
        role: '前端工程师',
        bucketStart: '2026-09-14',
        bucketEnd: '2026-09-20',
        forecastDemand: 90,
        actualAllocation: 70,
        gap: 30,
        confidence: 'low',
        roleRedaction: 'forbidden',
      }),
      roleBucket({
        role: '后端工程师',
        forecastDemand: 60,
        actualAllocation: 60,
        gap: 0,
        confidence: 'high',
      }),
    ] as ForecastRoleBucket[])
    expect(rows).toHaveLength(2)
    const frontend = rows.find((r) => r.key === '前端工程师')!
    // 维度全部受限：名称中性化；聚合数值仍为服务端下发的授权聚合
    expect(frontend.display).toBe('不可见')
    expect(frontend.redacted).toBe(true)
    expect(frontend.totalDemand).toBe(190)
    expect(frontend.gap).toBe(50) // 默认桶 gap20 + 次周 gap30
    expect(frontend.peakGapBucket).toBe('2026-09-14')
    expect(frontend.bucketCount).toBe(2)
    expect(frontend.confidence).toBe('low')
    const backend = rows.find((r) => r.key === '后端工程师')!
    expect(backend.display).toBe('后端工程师')
    expect(backend.totalDemand).toBe(60)
    // 按需求降序
    expect(rows[0]!.key).toBe('前端工程师')
  })

  test('受限判定：forbidden/unavailable/redacted 受限，缺省非受限', () => {
    expect(isDemandDimensionRedacted('forbidden')).toBe(true)
    expect(isDemandDimensionRedacted('unavailable')).toBe(true)
    expect(isDemandDimensionRedacted('redacted')).toBe(true)
    expect(isDemandDimensionRedacted(undefined)).toBe(false)
  })
})

// ─── 驱动标签（项目/技能）与数值格式化 ──────────────────────────────────

describe('驱动（项目/技能）标签（tasks 5.6）', () => {
  const projectDriver: ForecastProjectDriver = {
    projectId: '42',
    projectName: '商城重构',
    totalDemand: 500,
    totalAllocated: 400,
    demandShare: 0.6,
    peakGap: 120,
    peakGapBucket: '2026-09-14',
    confidence: 'high',
    warnings: [],
  }
  const skillDriver: ForecastSkillDriver = {
    skill: 'react',
    originalLabel: 'React 开发',
    totalDemand: 300,
    demandShare: 0.4,
    coveredHours: 200,
    gapHours: 100,
    projectCount: 3,
    confidence: 'medium',
    warnings: [],
  }

  test('项目驱动：名称回显与受限中性化', () => {
    expect(formatProjectDriverLabel(projectDriver)).toEqual({
      display: '商城重构',
      redacted: false,
    })
    expect(
      formatProjectDriverLabel({
        ...projectDriver,
        projectName: undefined,
        redaction: 'forbidden',
      }),
    ).toEqual({
      display: '不可见',
      redacted: true,
    })
    expect(formatProjectDriverLabel({ ...projectDriver, projectName: '' })).toEqual({
      display: '不可见',
      redacted: true,
    })
  })

  test('技能驱动：原始标签优先与受限中性化', () => {
    expect(formatSkillDriverLabel(skillDriver)).toEqual({ display: 'React 开发', redacted: false })
    expect(formatSkillDriverLabel({ ...skillDriver, originalLabel: undefined })).toEqual({
      display: 'react',
      redacted: false,
    })
    expect(formatSkillDriverLabel({ ...skillDriver, redaction: 'redacted' })).toEqual({
      display: '不可见',
      redacted: true,
    })
  })
})

// ─── gap-analysis 桶格式化 ───────────────────────────────────────────────

describe('gap-analysis 桶格式化（tasks 5.6）', () => {
  const analysis: ForecastGapAnalysis = {
    gaps: [
      makeGap({}),
      makeGap({
        gapType: 'surplus',
        direction: 'surplus',
        gapHours: 40,
        description: '后端富余',
        role: '后端工程师',
      }),
      makeGap({ bucketStart: '2026-09-14', bucketEnd: '2026-09-20', gapHours: 30 }),
    ],
    totalShortage: 150,
    totalSurplus: 40,
    netGap: 110,
    warnings: [],
  }

  test('瀑布聚合：按桶汇总短缺/盈余', () => {
    const buckets = buildGapWaterfall(analysis.gaps)
    expect(buckets).toEqual([
      { bucketStart: '2026-09-07', bucketEnd: '2026-09-13', shortageHours: 120, surplusHours: 40 },
      { bucketStart: '2026-09-14', bucketEnd: '2026-09-20', shortageHours: 30, surplusHours: 0 },
    ])
  })

  test('桶范围/维度/总览格式化', () => {
    expect(formatGapEntryBucket(makeGap({}))).toBe('2026-09-07 → 2026-09-13')
    expect(formatGapEntryBucket(makeGap({ bucketEnd: undefined }))).toBe('2026-09-07')
    expect(formatGapEntryBucket(makeGap({ bucketStart: undefined }))).toBe('—')
    expect(formatGapEntryDimension(makeGap({ role: '前端工程师', skill: 'React' }))).toBe(
      '角色 前端工程师 · 技能 React',
    )
    expect(formatGapEntryDimension(makeGap({ role: undefined, skill: undefined }))).toBe('—')
    expect(formatGapAnalysisTotals(analysis)).toEqual({
      totalShortage: '-150h',
      totalSurplus: '+40h',
      netGap: '-110h',
    })
  })
})

// ─── URL 状态解析/序列化（restorable filters） ──────────────────────────

describe('URL 状态解析/序列化（tasks 5.6/5.7 restorable）', () => {
  test('解析：合法值落入状态，缺省粒度 week', () => {
    const state = parseDemandUrlState(
      new URLSearchParams('view=gaps&granularity=month&startDate=2026-09-01&endDate=2026-11-30'),
    )
    expect(state).toEqual({
      view: 'gaps',
      granularity: 'month',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
    })
  })

  test('解析：脏值回落默认（view/granularity/日期各自兜底，绝不原样外发）', () => {
    const fallback = createDefaultForecastWindow()
    expect(
      parseDemandUrlState(new URLSearchParams('view=hack&granularity=bad&startDate=xx')),
    ).toEqual({
      view: 'curves',
      granularity: 'week',
      startDate: fallback.startDate,
      endDate: fallback.endDate,
    })
  })

  test('序列化：默认值不落参，激活值可分享；round-trip 恒等', () => {
    expect(
      serializeDemandUrlState({
        view: 'curves',
        granularity: 'week',
        startDate: createDefaultForecastWindow().startDate,
        endDate: createDefaultForecastWindow().endDate,
      }).toString(),
    ).toBe('')
    const qs = serializeDemandUrlState({
      view: 'gaps',
      granularity: 'month',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
    })
    expect(parseDemandUrlState(qs)).toEqual({
      view: 'gaps',
      granularity: 'month',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
    })
  })

  test('stateToQuery 与激活判定', () => {
    expect(
      demandUrlStateToQuery({
        view: 'curves',
        granularity: 'week',
        startDate: '2026-09-01',
        endDate: '2026-11-30',
      }),
    ).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      granularity: 'week',
    })
    expect(
      hasActiveDemandFilters({
        view: 'gaps',
        granularity: 'week',
        startDate: createDefaultForecastWindow().startDate,
        endDate: createDefaultForecastWindow().endDate,
      }),
    ).toBe(true)
    expect(
      hasActiveDemandFilters({
        view: 'curves',
        granularity: 'week',
        startDate: createDefaultForecastWindow().startDate,
        endDate: createDefaultForecastWindow().endDate,
      }),
    ).toBe(false)
  })
})
