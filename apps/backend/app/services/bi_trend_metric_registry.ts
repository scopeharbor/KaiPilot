import type {
  BiTrendMetricKey,
  BiTrendSourceKind,
  BiTrendGrain,
  BiTrendDimensionKey,
} from '@aiproj/types'
import {
  BI_TREND_METRIC_KEYS,
  BI_TREND_SOURCE_KINDS,
  BI_TREND_GRAINS,
  BI_TREND_DIMENSION_KEYS,
} from '@aiproj/types'

/**
 * 服务端指标注册表 —— 映射每个指标键到来源适配器、权限、粒度与安全下钻目标。
 *
 * v3-bi-trend-analysis §3.3：所有 BI 趋势查询须经过此白名单注册表；
 * 未注册的 metricKey 必须返回 unsupported/unavailable，防止任意查询。
 */

export interface BiTrendMetricDefinition {
  key: BiTrendMetricKey
  label: string
  sourceKind: BiTrendSourceKind
  metricVersion: string
  requiredPermission: string | null
  supportedGrains: BiTrendGrain[]
  supportedDimensions: BiTrendDimensionKey[]
  defaultCompareMode: string
  drilldownTargetKind: string
  unit: string
  lowerIsBetter: boolean
}

export const BI_TREND_METRIC_REGISTRY: readonly BiTrendMetricDefinition[] = [
  {
    key: BI_TREND_METRIC_KEYS.PROJECT_PROGRESS,
    label: '项目进度',
    sourceKind: BI_TREND_SOURCE_KINDS.ORGANIZATION_DASHBOARD,
    metricVersion: 'bi-trend-v1',
    requiredPermission: null,
    supportedGrains: [BI_TREND_GRAINS.WEEK, BI_TREND_GRAINS.MONTH],
    supportedDimensions: [
      BI_TREND_DIMENSION_KEYS.PROJECT,
      BI_TREND_DIMENSION_KEYS.DEPARTMENT,
      BI_TREND_DIMENSION_KEYS.PORTFOLIO_GROUP,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: 'project',
    unit: 'percent',
    lowerIsBetter: false,
  },
  {
    key: BI_TREND_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE,
    label: '延期压力',
    sourceKind: BI_TREND_SOURCE_KINDS.PMO_PORTFOLIO_DASHBOARD,
    metricVersion: 'bi-trend-v1',
    requiredPermission: null,
    supportedGrains: [BI_TREND_GRAINS.WEEK, BI_TREND_GRAINS.MONTH],
    supportedDimensions: [
      BI_TREND_DIMENSION_KEYS.PROJECT,
      BI_TREND_DIMENSION_KEYS.DEPARTMENT,
      BI_TREND_DIMENSION_KEYS.PORTFOLIO_GROUP,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: 'project',
    unit: 'percent',
    lowerIsBetter: true,
  },
  {
    key: BI_TREND_METRIC_KEYS.RISK_PRESSURE,
    label: '风险压力',
    sourceKind: BI_TREND_SOURCE_KINDS.RISK_REGISTER,
    metricVersion: 'bi-trend-v1',
    requiredPermission: 'risk:view',
    supportedGrains: [BI_TREND_GRAINS.WEEK, BI_TREND_GRAINS.MONTH],
    supportedDimensions: [BI_TREND_DIMENSION_KEYS.PROJECT, BI_TREND_DIMENSION_KEYS.RISK_LEVEL],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: 'risk',
    unit: 'score',
    lowerIsBetter: true,
  },
  {
    key: BI_TREND_METRIC_KEYS.RESOURCE_PRESSURE,
    label: '资源压力',
    sourceKind: BI_TREND_SOURCE_KINDS.RESOURCE_GAP_ANALYSIS,
    metricVersion: 'bi-trend-v1',
    requiredPermission: 'resource:view',
    supportedGrains: [BI_TREND_GRAINS.WEEK, BI_TREND_GRAINS.MONTH],
    supportedDimensions: [
      BI_TREND_DIMENSION_KEYS.PROJECT,
      BI_TREND_DIMENSION_KEYS.ROLE,
      BI_TREND_DIMENSION_KEYS.SKILL,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: 'resource',
    unit: 'percent',
    lowerIsBetter: true,
  },
  {
    key: BI_TREND_METRIC_KEYS.FORECAST_DEMAND_PRESSURE,
    label: '预测需求压力',
    sourceKind: BI_TREND_SOURCE_KINDS.RESOURCE_DEMAND_FORECASTING,
    metricVersion: 'bi-trend-v1',
    requiredPermission: 'prediction:view',
    supportedGrains: [BI_TREND_GRAINS.WEEK, BI_TREND_GRAINS.MONTH],
    supportedDimensions: [
      BI_TREND_DIMENSION_KEYS.PROJECT,
      BI_TREND_DIMENSION_KEYS.ROLE,
      BI_TREND_DIMENSION_KEYS.SKILL,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: 'resource-forecast',
    unit: 'hours',
    lowerIsBetter: true,
  },
  {
    key: BI_TREND_METRIC_KEYS.OKR_PROGRESS,
    label: 'OKR 进展',
    sourceKind: BI_TREND_SOURCE_KINDS.OKR_HIERARCHY,
    metricVersion: 'bi-trend-v1',
    requiredPermission: 'portfolio:view',
    supportedGrains: [BI_TREND_GRAINS.WEEK, BI_TREND_GRAINS.MONTH],
    supportedDimensions: [BI_TREND_DIMENSION_KEYS.PROJECT, BI_TREND_DIMENSION_KEYS.DEPARTMENT],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: 'okr',
    unit: 'percent',
    lowerIsBetter: false,
  },
]

export const BI_TREND_METRIC_BY_KEY: ReadonlyMap<string, BiTrendMetricDefinition> = new Map(
  BI_TREND_METRIC_REGISTRY.map((def) => [def.key, def]),
)

export function resolveBiTrendMetric(key: string): BiTrendMetricDefinition | undefined {
  return BI_TREND_METRIC_BY_KEY.get(key)
}
