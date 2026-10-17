import { describe, expect, test } from 'vitest'
import {
  BI_TREND_METRIC_VERSION,
  BI_TREND_METRIC_KEYS,
  BI_TREND_METRIC_KEY_VALUES,
  BI_TREND_UNSUPPORTED_METRIC_KEYS,
  BI_TREND_UNSUPPORTED_METRIC_KEY_VALUES,
  BI_TREND_SOURCE_KINDS,
  BI_TREND_SOURCE_KIND_VALUES,
  BI_TREND_GRAINS,
  BI_TREND_GRAIN_VALUES,
  BI_TREND_WINDOWS,
  BI_TREND_WINDOW_VALUES,
  BI_TREND_WINDOW_DAYS,
  BI_TREND_DIMENSION_KEYS,
  BI_TREND_DIMENSION_KEY_VALUES,
  BI_TREND_COMPARE_MODES,
  BI_TREND_COMPARE_MODE_VALUES,
  BI_TREND_WARNING_CODES,
  BI_TREND_WARNING_CODE_VALUES,
  BI_TREND_REDACTION_STATES,
  BI_TREND_REDACTION_STATE_VALUES,
  BI_TREND_DRILLDOWN_TARGET_KINDS,
  BI_TREND_DRILLDOWN_TARGET_KIND_VALUES,
  BI_TREND_SORT_KEYS,
  BI_TREND_SORT_KEY_VALUES,
  BI_TREND_MAX_METRICS,
  BI_TREND_MAX_DIMENSIONS,
  BI_TREND_MAX_PER_PAGE,
  BI_TREND_MAX_WINDOW_DAYS,
  buildBiTrendWarning,
  buildBiTrendQueryShape,
  serializeBiTrendQuery,
  redactBiTrendEvidence,
  isBiTrendRedacted,
  isSupportedBiTrendMetricKey,
  isUnsupportedFinancialMetricKey,
  isSupportedBiTrendGrain,
  isSupportedBiTrendWindow,
  isSupportedBiTrendDimension,
  isBiTrendWindowWithinBounds,
  isBiTrendMetricCountWithinLimit,
  isBiTrendDimensionCountWithinLimit,
  isBiTrendForecastEligible,
  isBiTrendDirectionEligible,
} from './bi-trend-analysis.js'
import type { BiTrendQuery } from './bi-trend-analysis.js'

describe('BI 趋势分析共享契约（v3-bi-trend-analysis §2.5）', () => {
  test('metric version 稳定', () => {
    expect(BI_TREND_METRIC_VERSION).toBe('bi-trend-v1')
  })

  test('指标键枚举稳定（首批六类）', () => {
    expect(BI_TREND_METRIC_KEYS).toEqual({
      PROJECT_PROGRESS: 'project_progress',
      SCHEDULE_DELAY_PRESSURE: 'schedule_delay_pressure',
      RISK_PRESSURE: 'risk_pressure',
      RESOURCE_PRESSURE: 'resource_pressure',
      FORECAST_DEMAND_PRESSURE: 'forecast_demand_pressure',
      OKR_PROGRESS: 'okr_progress',
    })
    expect(BI_TREND_METRIC_KEY_VALUES).toHaveLength(6)
  })

  test('unsupported 财务指标键枚举稳定', () => {
    expect(BI_TREND_UNSUPPORTED_METRIC_KEYS).toEqual({
      BUDGET_COST: 'budget_cost',
      ROI: 'roi',
      CASH_FLOW: 'cash_flow',
      BUDGET_VARIANCE: 'budget_variance',
    })
    expect(BI_TREND_UNSUPPORTED_METRIC_KEY_VALUES).toHaveLength(4)
  })

  test('来源类型 / 粒度 / 窗口 / 维度枚举稳定', () => {
    expect(BI_TREND_SOURCE_KIND_VALUES).toEqual([
      'organization_dashboard',
      'pmo_portfolio_dashboard',
      'resource_demand_forecasting',
      'resource_gap_analysis',
      'resource_contention_detection',
      'okr_hierarchy',
      'report_snapshot',
      'risk_register',
      'health_snapshot',
    ])
    expect(BI_TREND_SOURCE_KINDS.OKR_HIERARCHY).toBe('okr_hierarchy')
    expect(BI_TREND_GRAIN_VALUES).toEqual(['day', 'week', 'month'])
    expect(BI_TREND_GRAINS.WEEK).toBe('week')
    expect(BI_TREND_WINDOW_VALUES).toEqual([
      'last_7_days',
      'last_30_days',
      'last_90_days',
      'last_12_weeks',
      'last_6_months',
      'last_12_months',
    ])
    expect(BI_TREND_WINDOWS.LAST_90_DAYS).toBe('last_90_days')
    expect(BI_TREND_DIMENSION_KEY_VALUES).toEqual([
      'project',
      'department',
      'role',
      'skill',
      'portfolio_group',
      'okr_level',
      'risk_level',
    ])
    expect(BI_TREND_DIMENSION_KEYS.RISK_LEVEL).toBe('risk_level')
    expect(BI_TREND_COMPARE_MODE_VALUES).toEqual(['none', 'previous_period'])
    expect(BI_TREND_COMPARE_MODES.PREVIOUS_PERIOD).toBe('previous_period')
  })

  test('warning code 与 redaction 状态枚举稳定', () => {
    expect(BI_TREND_WARNING_CODES).toEqual({
      INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
      MISSING_BUCKETS: 'MISSING_BUCKETS',
      STALE_SOURCE: 'STALE_SOURCE',
      SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
      SOURCE_MISSING: 'SOURCE_MISSING',
      PARTIAL_VISIBILITY: 'PARTIAL_VISIBILITY',
      DIMENSION_REDACTED: 'DIMENSION_REDACTED',
      CACHE_DEGRADED: 'CACHE_DEGRADED',
      UNSUPPORTED_METRIC: 'UNSUPPORTED_METRIC',
      UNSUPPORTED_FINANCIAL_METRIC: 'UNSUPPORTED_FINANCIAL_METRIC',
      FORECAST_SUPPRESSED: 'FORECAST_SUPPRESSED',
      NO_PROJECTS_VISIBLE: 'NO_PROJECTS_VISIBLE',
    })
    expect(BI_TREND_WARNING_CODE_VALUES).toHaveLength(12)
    expect(BI_TREND_REDACTION_STATE_VALUES).toEqual(['forbidden', 'unavailable', 'redacted'])
    expect(BI_TREND_REDACTION_STATES.FORBIDDEN).toBe('forbidden')
  })

  test('下钻目标类型与排序键枚举稳定', () => {
    expect(BI_TREND_DRILLDOWN_TARGET_KIND_VALUES).toEqual([
      'project',
      'pmo_portfolio',
      'okr',
      'resource',
      'risk',
      'report',
      'dashboard',
    ])
    expect(BI_TREND_DRILLDOWN_TARGET_KINDS.PROJECT).toBe('project')
    expect(BI_TREND_SORT_KEY_VALUES).toEqual([
      'metricKey',
      'direction',
      'latestValue',
      'anomalyCount',
      'freshness',
    ])
    expect(BI_TREND_SORT_KEYS.DIRECTION).toBe('direction')
  })

  test('有界限制常量稳定', () => {
    expect(BI_TREND_MAX_METRICS).toBe(8)
    expect(BI_TREND_MAX_DIMENSIONS).toBe(3)
    expect(BI_TREND_MAX_PER_PAGE).toBe(100)
    expect(BI_TREND_MAX_WINDOW_DAYS).toBe(366)
    expect(BI_TREND_WINDOW_DAYS.last_12_months).toBe(366)
  })

  test('守护 helpers：指标键 / 财务指标 / 粒度 / 窗口 / 维度', () => {
    expect(isSupportedBiTrendMetricKey('project_progress')).toBe(true)
    expect(isSupportedBiTrendMetricKey('budget_cost')).toBe(false)
    expect(isUnsupportedFinancialMetricKey('budget_cost')).toBe(true)
    expect(isUnsupportedFinancialMetricKey('roi')).toBe(true)
    expect(isUnsupportedFinancialMetricKey('project_progress')).toBe(false)
    expect(isSupportedBiTrendGrain('day')).toBe(true)
    expect(isSupportedBiTrendGrain('hour')).toBe(false)
    expect(isSupportedBiTrendWindow('last_30_days')).toBe(true)
    expect(isSupportedBiTrendWindow('last_1000_days')).toBe(false)
    expect(isSupportedBiTrendDimension('risk_level')).toBe(true)
    expect(isSupportedBiTrendDimension('member_name')).toBe(false)
  })

  test('守护 helpers：窗口边界 / 指标数 / 维度数 / forecast 资格', () => {
    expect(isBiTrendWindowWithinBounds('last_12_months')).toBe(true)
    expect(isBiTrendMetricCountWithinLimit(1)).toBe(true)
    expect(isBiTrendMetricCountWithinLimit(8)).toBe(true)
    expect(isBiTrendMetricCountWithinLimit(9)).toBe(false)
    expect(isBiTrendMetricCountWithinLimit(0)).toBe(false)
    expect(isBiTrendDimensionCountWithinLimit(0)).toBe(true)
    expect(isBiTrendDimensionCountWithinLimit(3)).toBe(true)
    expect(isBiTrendDimensionCountWithinLimit(4)).toBe(false)
    expect(isBiTrendDirectionEligible(3)).toBe(true)
    expect(isBiTrendDirectionEligible(2)).toBe(false)
    expect(isBiTrendForecastEligible(6)).toBe(true)
    expect(isBiTrendForecastEligible(5)).toBe(false)
  })

  test('warning helper 生成低敏 warning', () => {
    const warning = buildBiTrendWarning('INSUFFICIENT_HISTORY', '历史样本不足', {
      metricKey: 'okr_progress',
      dimension: 'okr_level',
    })
    expect(warning).toEqual({
      code: 'INSUFFICIENT_HISTORY',
      message: '历史样本不足',
      metricKey: 'okr_progress',
      dimension: 'okr_level',
    })
  })

  test('redaction helper 隐藏 targetId 并标注 redacted', () => {
    const ref = {
      kind: 'risk_register' as const,
      label: '风险压力桶 2026-07',
      targetKind: 'risk' as const,
      targetId: 'risk-42',
    }
    const redacted = redactBiTrendEvidence(ref)
    expect(redacted.targetId).toBeUndefined()
    expect(redacted.redaction).toBe('redacted')
    expect(isBiTrendRedacted(redacted)).toBe(true)
    expect(isBiTrendRedacted(ref)).toBe(false)
  })

  test('查询形状：只保留键与计数，不保留具体筛选值', () => {
    const query: BiTrendQuery = {
      metricKeys: ['project_progress', 'risk_pressure'],
      window: 'last_90_days',
      grain: 'week',
      dimensions: ['project', 'risk_level'],
      filters: {
        projectIds: ['p-1', 'p-2'],
        departments: ['工程部'],
        skills: ['typescript'],
      },
      compareWith: 'previous_period',
      includeAnomalies: true,
      includeForecast: true,
      page: 2,
      perPage: 50,
    }
    const shape = buildBiTrendQueryShape(query)
    expect(shape).toEqual({
      metricKeys: ['project_progress', 'risk_pressure'],
      window: 'last_90_days',
      grain: 'week',
      dimensionCount: 2,
      filterCounts: {
        projects: 2,
        departments: 1,
        roles: 0,
        skills: 1,
        portfolioGroups: 0,
        riskLevels: 0,
      },
      compareWith: 'previous_period',
      includeAnomalies: true,
      includeForecast: true,
      page: 2,
      perPage: 50,
    })
    // 形状中不得出现具体筛选值
    const serialized = JSON.stringify(shape)
    expect(serialized).not.toContain('p-1')
    expect(serialized).not.toContain('工程部')
    expect(serialized).not.toContain('typescript')
  })

  test('查询序列化：扁平、低敏、数组逗号连接', () => {
    const query: BiTrendQuery = {
      metricKeys: ['resource_pressure'],
      window: 'last_30_days',
      grain: 'day',
      dimensions: ['role'],
      filters: { roles: ['pm', 'dev'] },
      compareWith: 'none',
      includeAnomalies: false,
      includeForecast: false,
      sort: 'direction',
      sortDir: 'desc',
      page: 1,
      perPage: 20,
    }
    const params = serializeBiTrendQuery(query)
    expect(params).toEqual({
      metricKeys: 'resource_pressure',
      window: 'last_30_days',
      grain: 'day',
      dimensions: 'role',
      roles: 'pm,dev',
      compareWith: 'none',
      includeAnomalies: 'false',
      includeForecast: 'false',
      sort: 'direction',
      sortDir: 'desc',
      page: '1',
      perPage: '20',
    })
  })

  test('向后兼容导出：契约模块只依赖本包内部，无运行时框架依赖', async () => {
    // 契约文件顶部不得 import 任何框架；通过模块可独立加载间接验证。
    const mod = await import('./bi-trend-analysis.js')
    expect(mod.BI_TREND_METRIC_VERSION).toBe('bi-trend-v1')
    expect(typeof mod.normalizeBiTrendBuckets).toBe('function')
    expect(typeof mod.summarizeBiTrendSeries).toBe('function')
    expect(typeof mod.aggregateBiTrendFreshness).toBe('function')
  })
})
