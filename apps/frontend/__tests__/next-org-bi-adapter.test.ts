/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.2 —— 组织 BI 纯函数适配器单测。
 *
 * 覆盖（tasks 3.2）：
 * - 5×5 概率×影响色阶角点（1×1 / 5×5）与全等级元数据（双通道文案 + 令牌）；
 * - 趋势异常分级（|z| 阈值边界）与方向/洞察严重度文案映射；
 * - 数值格式化：大数（万/亿/千分位）、百分比、负向指标带符号、时长；
 * - 指标/维度/窗口/widget/作用域/尺寸/密度中文标签全覆盖。
 */
import { describe, expect, test } from 'vitest'
import {
  BI_ANOMALY_DIRECTION_LABELS,
  BI_ANOMALY_SEVERITY_META,
  BI_DASHBOARD_DENSITY_LABELS,
  BI_DASHBOARD_SCOPE_LABELS,
  BI_HEAT_LEVEL_META,
  BI_RISK_HEATMAP_DIMENSIONS,
  BI_RISK_HEATMAP_METRIC_KEYS,
  BI_RISK_HEATMAP_WINDOWS,
  BI_TREND_INSIGHT_SEVERITY_META,
  BI_TREND_METRIC_KEYS,
  BI_TREND_METRIC_UNITS,
  BI_WIDGET_SIZE_LABELS,
  BI_WIDGET_TYPE_LABELS,
  biDashboardScopeLabel,
  biHeatLevelMeta,
  biRiskHeatmapCompareLabel,
  biRiskHeatmapDimensionLabel,
  biRiskHeatmapMetricLabel,
  biRiskHeatmapWindowLabel,
  biTrendGrainLabel,
  biTrendMetricLabel,
  biTrendWindowLabel,
  biWidgetSizeLabel,
  biWidgetTypeDescription,
  biWidgetTypeLabel,
  buildTrendChartModel,
  classifyTrendAnomalySeverity,
  formatBiMetricNumber,
  formatBiMetricPercent,
  formatBiTrendValue,
  formatCompareText,
  formatSignedDelta,
  formatTrendBucketLabel,
  heatLevelOfScore,
  latestNonNull,
  probabilityImpactHeatLevel,
} from '@/lib/next/org-bi/org-bi-adapter'
import type { BiRiskHeatmapCellRiskLevel } from '@aiproj/types'

describe('热力色阶（5×5 概率×影响 → --nx-* 令牌，双通道）', () => {
  test('色阶角点：1×1 低危、5×5 严重、1×5/5×1 中低区间确定', () => {
    expect(probabilityImpactHeatLevel(1, 1)).toBe('low')
    expect(probabilityImpactHeatLevel(5, 5)).toBe('critical')
    expect(probabilityImpactHeatLevel(4, 5)).toBe('critical') // 20/25 = 0.8
    expect(probabilityImpactHeatLevel(3, 5)).toBe('high') // 15/25 = 0.6
    expect(probabilityImpactHeatLevel(2, 3)).toBe('low') // 6/25 = 0.24 < 0.25
    expect(probabilityImpactHeatLevel(2, 4)).toBe('medium') // 8/25 = 0.32
    expect(probabilityImpactHeatLevel(1, 5)).toBe('low') // 5/25 = 0.2
  })

  test('概率/影响越界值收敛到 1..5', () => {
    expect(probabilityImpactHeatLevel(0, 6)).toBe(probabilityImpactHeatLevel(1, 5))
    expect(probabilityImpactHeatLevel(99, 1)).toBe('low') // 归一化到 5×1
  })

  test('score 分级边界：0.8/0.5/0.25 阈值与样本不足降级', () => {
    expect(heatLevelOfScore(0.8, 5)).toBe('critical')
    expect(heatLevelOfScore(0.5, 5)).toBe('high')
    expect(heatLevelOfScore(0.25, 5)).toBe('medium')
    expect(heatLevelOfScore(0.24, 5)).toBe('low')
    // 样本不足（<3）一律数据不足，即使 score 极高也不误报严重
    expect(heatLevelOfScore(0.99, 2)).toBe('insufficient_data')
  })

  test('五级元数据全量：每级都有中文文案与令牌（双通道），severity 色阶互斥', () => {
    const levels: BiRiskHeatmapCellRiskLevel[] = [
      'critical',
      'high',
      'medium',
      'low',
      'insufficient_data',
    ]
    for (const level of levels) {
      const meta = biHeatLevelMeta(level)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.token.startsWith('var(--nx-')).toBe(true)
      expect(meta.bg.startsWith('rgba(')).toBe(true)
    }
    expect(BI_HEAT_LEVEL_META.critical.label).toBe('严重')
    expect(BI_HEAT_LEVEL_META.high.label).toBe('高')
    expect(BI_HEAT_LEVEL_META.medium.label).toBe('中')
    expect(BI_HEAT_LEVEL_META.low.label).toBe('低')
    expect(BI_HEAT_LEVEL_META.insufficient_data.label).toBe('数据不足')
    // 颜色 + 文案双通道：不同等级的令牌不互相覆盖
    const tokens = levels.map((level) => BI_HEAT_LEVEL_META[level].token)
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})

describe('趋势异常分级与严重度徽标', () => {
  test('|z| 阈值边界：4/3/2 分档', () => {
    expect(classifyTrendAnomalySeverity(1.9)).toBe('low')
    expect(classifyTrendAnomalySeverity(2)).toBe('medium')
    expect(classifyTrendAnomalySeverity(2.99)).toBe('medium')
    expect(classifyTrendAnomalySeverity(3)).toBe('high')
    expect(classifyTrendAnomalySeverity(-3.5)).toBe('high') // 负值按绝对值
    expect(classifyTrendAnomalySeverity(4)).toBe('critical')
    expect(classifyTrendAnomalySeverity(-6.2)).toBe('critical')
  })

  test('异常严重度元数据齐全（文案 + 令牌双通道）', () => {
    expect(BI_ANOMALY_SEVERITY_META.critical.label).toBe('严重')
    expect(BI_ANOMALY_SEVERITY_META.high.label).toBe('高')
    expect(BI_ANOMALY_SEVERITY_META.medium.label).toBe('中')
    expect(BI_ANOMALY_SEVERITY_META.low.label).toBe('低')
    expect(BI_ANOMALY_SEVERITY_META.critical.token).toContain('nx-status-danger')
    expect(BI_ANOMALY_SEVERITY_META.medium.token).toContain('nx-chart-4')
    expect(BI_ANOMALY_DIRECTION_LABELS.above).toBe('高于期望')
    expect(BI_ANOMALY_DIRECTION_LABELS.below).toBe('低于期望')
  })

  test('洞察严重度 info/attention/critical → 徽标映射', () => {
    expect(BI_TREND_INSIGHT_SEVERITY_META.info.label).toBe('信息')
    expect(BI_TREND_INSIGHT_SEVERITY_META.attention.label).toBe('关注')
    expect(BI_TREND_INSIGHT_SEVERITY_META.critical.label).toBe('严重')
    expect(BI_TREND_INSIGHT_SEVERITY_META.critical.token).toContain('nx-status-danger')
  })
})

describe('数值格式化（大数/百分比/带符号变化量/指标单位）', () => {
  test('大数：万/亿/千分位边界', () => {
    expect(formatBiMetricNumber(0)).toBe('0')
    expect(formatBiMetricNumber(1234)).toBe('1,234')
    expect(formatBiMetricNumber(12345)).toBe('1.23 万')
    expect(formatBiMetricNumber(123456789)).toBe('1.23 亿')
    expect(formatBiMetricNumber(-9876)).toBe('-9,876')
    expect(formatBiMetricNumber(-12345)).toBe('-1.23 万')
    expect(formatBiMetricNumber(9999.5)).toBe('9,999.5')
    expect(formatBiMetricNumber(1234.5)).toBe('1,234.5')
  })

  test('百分比与带符号变化量（同比/环比符号）', () => {
    expect(formatBiMetricPercent(12.345)).toBe('12.3%')
    expect(formatBiMetricPercent(0)).toBe('0.0%')
    expect(formatSignedDelta(12.3)).toBe('+12.3')
    expect(formatSignedDelta(-5.2)).toBe('-5.2')
    expect(formatSignedDelta(0)).toBe('0')
    // 组合文案：rate 优先百分比、rate 缺失回落绝对量
    expect(formatCompareText(0.123, 12)).toBe('+12.3%')
    expect(formatCompareText(-0.05, -2)).toBe('-5%')
    expect(formatCompareText(null, 12)).toBe('+12')
    expect(formatCompareText(null, -2.4, { deltaDigits: 1 })).toBe('-2.4')
  })

  test('负向指标与单位（percent/hours/score）格式化', () => {
    expect(formatBiTrendValue('project_progress', 42.36)).toBe('42.4%')
    expect(formatBiTrendValue('forecast_demand_pressure', 128)).toBe('128 h')
    expect(formatBiTrendValue('risk_pressure', 3.14159, 2)).toBe('3.14')
    expect(formatBiTrendValue('okr_progress', 100)).toBe('100.0%')
    expect(BI_TREND_METRIC_UNITS.project_progress).toBe('percent')
    expect(BI_TREND_METRIC_UNITS.forecast_demand_pressure).toBe('hours')
    expect(BI_TREND_METRIC_UNITS.risk_pressure).toBe('score')
  })
})

describe('中文标签映射（指标/窗口/维度/对比/widget/作用域/尺寸）', () => {
  test('BI 风险热力指标全覆盖', () => {
    expect(BI_RISK_HEATMAP_METRIC_KEYS.length).toBeGreaterThanOrEqual(6)
    expect(biRiskHeatmapMetricLabel('risk_exposure_score')).toBe('风险暴露评分')
    expect(biRiskHeatmapMetricLabel('risk_count')).toBe('风险数量')
    expect(biRiskHeatmapMetricLabel('high_risk_ratio')).toBe('高风险占比')
    expect(biRiskHeatmapMetricLabel('overdue_risk_ratio')).toBe('逾期风险占比')
    expect(biRiskHeatmapMetricLabel('risk_delta')).toBe('风险变化量')
    expect(biRiskHeatmapMetricLabel('traffic_light_risk_ratio')).toBe('交通灯风险比')
    expect(BI_RISK_HEATMAP_WINDOWS).toContain('last_90_days')
    expect(biRiskHeatmapWindowLabel('last_90_days')).toBe('最近 90 天')
    expect(biRiskHeatmapWindowLabel('current_quarter')).toBe('本季度')
    expect(BI_RISK_HEATMAP_DIMENSIONS).toContain('risk_level')
    expect(biRiskHeatmapDimensionLabel('project')).toBe('项目')
    expect(biRiskHeatmapDimensionLabel('risk_status')).toBe('风险状态')
    expect(biRiskHeatmapCompareLabel('previous_period')).toBe('与上期对比')
    expect(biRiskHeatmapCompareLabel('none')).toBe('无对比')
  })

  test('趋势指标/窗口/粒度全覆盖', () => {
    expect(BI_TREND_METRIC_KEYS.length).toBe(6)
    expect(biTrendMetricLabel('project_progress')).toBe('项目进度')
    expect(biTrendMetricLabel('schedule_delay_pressure')).toBe('延期压力')
    expect(biTrendMetricLabel('risk_pressure')).toBe('风险压力')
    expect(biTrendMetricLabel('resource_pressure')).toBe('资源压力')
    expect(biTrendMetricLabel('forecast_demand_pressure')).toBe('预测需求压力')
    expect(biTrendMetricLabel('okr_progress')).toBe('OKR 进展')
    expect(biTrendWindowLabel('last_12_weeks')).toBe('最近 12 周')
    expect(biTrendWindowLabel('last_6_months')).toBe('最近 6 个月')
    expect(biTrendGrainLabel('day')).toBe('日')
    expect(biTrendGrainLabel('week')).toBe('周')
    expect(biTrendGrainLabel('month')).toBe('月')
  })

  test('widget 类型标签与只读描述、作用域/尺寸/密度标签', () => {
    expect(biWidgetTypeLabel('bi_trend')).toBe('BI 趋势')
    expect(biWidgetTypeLabel('bi_risk_heatmap')).toBe('风险热力图')
    expect(biWidgetTypeLabel('okr_summary')).toBe('OKR 概览')
    expect(biWidgetTypeLabel('unknown_future_widget')).toBe('unknown_future_widget')
    expect(biWidgetTypeDescription('bi_trend')).toContain('时序趋势')
    expect(biWidgetTypeDescription('not_a_key')).toBe('')
    expect(Object.keys(BI_WIDGET_TYPE_LABELS)).toHaveLength(7)
    expect(biDashboardScopeLabel('personal')).toBe('我的仪表盘')
    expect(biDashboardScopeLabel('organization_shared')).toBe('组织共享')
    expect(BI_DASHBOARD_SCOPE_LABELS.personal).toBe('我的仪表盘')
    expect(biWidgetSizeLabel('small')).toBe('小')
    expect(biWidgetSizeLabel('full')).toBe('全宽')
    expect(BI_WIDGET_SIZE_LABELS.large).toBe('大')
    expect(BI_DASHBOARD_DENSITY_LABELS.comfortable).toBe('舒适')
    expect(BI_DASHBOARD_DENSITY_LABELS.compact).toBe('紧凑')
  })
})

describe('趋势线图数据模型（桶对齐/缺口/外推合并/异常点）', () => {
  test('主序列 + 移动平均对齐，缺失桶保留 null 缺口', () => {
    const model = buildTrendChartModel({
      metricKey: 'project_progress',
      metricVersion: 'bi-trend-v1',
      grain: 'week',
      window: 'last_12_weeks',
      points: [
        {
          bucketStart: '2026-09-07T00:00:00.000Z',
          bucketEnd: '2026-09-13T00:00:00.000Z',
          value: 10,
          missing: false,
          sampleCount: 4,
        },
        {
          bucketStart: '2026-09-14T00:00:00.000Z',
          bucketEnd: '2026-09-20T00:00:00.000Z',
          value: null,
          missing: true,
          sampleCount: 0,
        },
        {
          bucketStart: '2026-09-21T00:00:00.000Z',
          bucketEnd: '2026-09-27T00:00:00.000Z',
          value: 20,
          missing: false,
          sampleCount: 4,
        },
      ],
      movingAverage: [8, null, 15],
      direction: 'up',
      anomalies: [],
      freshness: { state: 'fresh', sourceCoverage: 1, freshnessHash: 'h', sources: [] },
      warnings: [],
      insights: [],
      evidenceRefs: [],
      sampleCount: 8,
    })
    expect(model.categories).toEqual(['09-07', '09-14', '09-21'])
    expect(model.values).toEqual([10, null, 20])
    expect(model.movingAverage).toEqual([8, null, 15])
    expect(model.anomalyPoints).toEqual([])
    expect(model.forecast.every((value) => value === null)).toBe(true)
  })

  test('外推续段自动追加轴桶并前缀 null 占位', () => {
    const model = buildTrendChartModel({
      metricKey: 'resource_pressure',
      metricVersion: 'bi-trend-v1',
      grain: 'week',
      window: 'last_12_weeks',
      points: [
        {
          bucketStart: '2026-09-07T00:00:00.000Z',
          bucketEnd: '2026-09-13T00:00:00.000Z',
          value: 10,
          missing: false,
          sampleCount: 3,
        },
        {
          bucketStart: '2026-09-14T00:00:00.000Z',
          bucketEnd: '2026-09-20T00:00:00.000Z',
          value: 20,
          missing: false,
          sampleCount: 3,
        },
      ],
      movingAverage: [null, null],
      direction: 'up',
      anomalies: [],
      forecast: {
        method: 'linear_extrapolation',
        suppressed: false,
        points: [
          {
            bucketStart: '2026-09-21T00:00:00.000Z',
            bucketEnd: '2026-09-27T00:00:00.000Z',
            value: 26,
          },
          {
            bucketStart: '2026-09-28T00:00:00.000Z',
            bucketEnd: '2026-10-04T00:00:00.000Z',
            value: 32,
          },
        ],
      },
      freshness: { state: 'fresh', sourceCoverage: 1, freshnessHash: 'h', sources: [] },
      warnings: [],
      insights: [],
      evidenceRefs: [],
      sampleCount: 6,
    })
    expect(model.categories).toEqual(['09-07', '09-14', '09-21', '09-28'])
    expect(model.values).toEqual([10, 20, null, null])
    expect(model.forecast).toEqual([null, null, 26, 32])
  })

  test('异常点映射到轴索引（含主序列与外推合并后索引）', () => {
    const model = buildTrendChartModel({
      metricKey: 'okr_progress',
      metricVersion: 'bi-trend-v1',
      grain: 'month',
      window: 'last_6_months',
      points: [
        {
          bucketStart: '2026-01-01T00:00:00.000Z',
          bucketEnd: '2026-01-31T00:00:00.000Z',
          value: 30,
          missing: false,
          sampleCount: 5,
        },
        {
          bucketStart: '2026-02-01T00:00:00.000Z',
          bucketEnd: '2026-02-28T00:00:00.000Z',
          value: 45,
          missing: false,
          sampleCount: 5,
        },
        {
          bucketStart: '2026-03-01T00:00:00.000Z',
          bucketEnd: '2026-03-31T00:00:00.000Z',
          value: 60,
          missing: false,
          sampleCount: 5,
        },
      ],
      movingAverage: [null, 37.5, 52.5],
      direction: 'up',
      anomalies: [
        {
          bucketStart: '2026-02-01T00:00:00.000Z',
          value: 45,
          expected: 34,
          deviation: 11,
          zScore: 3.4,
          direction: 'above',
          threshold: 2,
          evidenceRefs: [],
        },
      ],
      freshness: { state: 'fresh', sourceCoverage: 1, freshnessHash: 'h', sources: [] },
      warnings: [],
      insights: [],
      evidenceRefs: [],
      sampleCount: 15,
    })
    expect(model.categories).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(model.anomalyPoints).toEqual([{ index: 1, value: 45 }])
    expect(formatTrendBucketLabel('2026-02-01T00:00:00.000Z', 'month')).toBe('2026-02')
  })

  test('最新非空值查找与空序列边界', () => {
    expect(
      latestNonNull([
        { bucketStart: 'a', bucketEnd: 'b', value: 1, missing: false, sampleCount: 1 },
      ]),
    ).toBe(1)
    expect(
      latestNonNull([
        { bucketStart: 'a', bucketEnd: 'b', value: null, missing: true, sampleCount: 0 },
        { bucketStart: 'c', bucketEnd: 'd', value: 5, missing: false, sampleCount: 2 },
      ]),
    ).toBe(5)
    expect(latestNonNull([])).toBeNull()
  })
})
