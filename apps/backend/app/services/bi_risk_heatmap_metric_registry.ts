import type {
  BiRiskHeatmapMetricKey,
  BiRiskHeatmapSourceKind,
  BiRiskHeatmapDimensionKey,
  BiRiskHeatmapWindow,
  BiRiskHeatmapDrilldownTargetKind,
} from '@aiproj/types'
import {
  BI_RISK_HEATMAP_METRIC_KEYS,
  BI_RISK_HEATMAP_SOURCE_KINDS,
  BI_RISK_HEATMAP_DIMENSION_KEYS,
  BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS,
} from '@aiproj/types'

/**
 * 服务端风险热力指标注册表 —— 映射每个指标键到来源适配器、权限、粒度与安全下钻目标。
 *
 * v3-bi-risk-heatmap §3.3：所有 BI 风险热力图查询须经过此白名单注册表；
 * 未注册的 metricKey 必须返回 unsupported/unavailable，防止任意查询。
 */

export interface BiRiskHeatmapMetricDefinition {
  key: BiRiskHeatmapMetricKey
  label: string
  sourceKind: BiRiskHeatmapSourceKind
  metricVersion: string
  requiredPermission: string | null
  supportedWindows: BiRiskHeatmapWindow[]
  supportedRowDimensions: BiRiskHeatmapDimensionKey[]
  supportedColumnDimensions: BiRiskHeatmapDimensionKey[]
  defaultCompareMode: string
  drilldownTargetKind: BiRiskHeatmapDrilldownTargetKind
  unit: string
  lowerIsBetter: boolean
}

export const BI_RISK_HEATMAP_METRIC_REGISTRY: readonly BiRiskHeatmapMetricDefinition[] = [
  {
    key: BI_RISK_HEATMAP_METRIC_KEYS.RISK_EXPOSURE_SCORE,
    label: '风险暴露评分',
    sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.RISK_REGISTER,
    metricVersion: 'bi-risk-heatmap-v1',
    requiredPermission: 'risk:view',
    supportedWindows: [
      'last_30_days',
      'last_90_days',
      'last_180_days',
      'last_365_days',
      'current_quarter',
    ],
    supportedRowDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.PROJECT,
      BI_RISK_HEATMAP_DIMENSION_KEYS.PORTFOLIO_GROUP,
      BI_RISK_HEATMAP_DIMENSION_KEYS.DEPARTMENT,
    ],
    supportedColumnDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_LEVEL,
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_CATEGORY,
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_STATUS,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS.RISK,
    unit: 'score',
    lowerIsBetter: true,
  },
  {
    key: BI_RISK_HEATMAP_METRIC_KEYS.RISK_COUNT,
    label: '风险数量',
    sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.RISK_REGISTER,
    metricVersion: 'bi-risk-heatmap-v1',
    requiredPermission: 'risk:view',
    supportedWindows: [
      'last_7_days',
      'last_30_days',
      'last_90_days',
      'last_180_days',
      'last_365_days',
      'current_month',
      'current_quarter',
    ],
    supportedRowDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.PROJECT,
      BI_RISK_HEATMAP_DIMENSION_KEYS.PORTFOLIO_GROUP,
      BI_RISK_HEATMAP_DIMENSION_KEYS.ASSIGNEE,
      BI_RISK_HEATMAP_DIMENSION_KEYS.DEPARTMENT,
    ],
    supportedColumnDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_LEVEL,
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_CATEGORY,
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_STATUS,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS.RISK_MATRIX,
    unit: 'count',
    lowerIsBetter: true,
  },
  {
    key: BI_RISK_HEATMAP_METRIC_KEYS.HIGH_RISK_RATIO,
    label: '高风险占比',
    sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.RISK_MATRIX,
    metricVersion: 'bi-risk-heatmap-v1',
    requiredPermission: 'risk:view',
    supportedWindows: ['last_30_days', 'last_90_days', 'last_180_days', 'current_quarter'],
    supportedRowDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.PROJECT,
      BI_RISK_HEATMAP_DIMENSION_KEYS.PORTFOLIO_GROUP,
      BI_RISK_HEATMAP_DIMENSION_KEYS.DEPARTMENT,
    ],
    supportedColumnDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_CATEGORY,
      BI_RISK_HEATMAP_DIMENSION_KEYS.TIME_BUCKET,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS.RISK_MATRIX,
    unit: 'ratio',
    lowerIsBetter: true,
  },
  {
    key: BI_RISK_HEATMAP_METRIC_KEYS.OVERDUE_RISK_RATIO,
    label: '逾期风险占比',
    sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.ORGANIZATION_DASHBOARD_RISK,
    metricVersion: 'bi-risk-heatmap-v1',
    requiredPermission: 'risk:view',
    supportedWindows: ['last_30_days', 'last_90_days', 'last_180_days', 'current_quarter'],
    supportedRowDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.PROJECT,
      BI_RISK_HEATMAP_DIMENSION_KEYS.PORTFOLIO_GROUP,
      BI_RISK_HEATMAP_DIMENSION_KEYS.ASSIGNEE,
    ],
    supportedColumnDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_STATUS,
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_CATEGORY,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS.RISK,
    unit: 'ratio',
    lowerIsBetter: true,
  },
  {
    key: BI_RISK_HEATMAP_METRIC_KEYS.RISK_DELTA,
    label: '风险变化量',
    sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.PMO_TRAFFIC_LIGHT,
    metricVersion: 'bi-risk-heatmap-v1',
    requiredPermission: 'portfolio:view',
    supportedWindows: [
      'last_30_days',
      'last_90_days',
      'last_180_days',
      'current_quarter',
      'current_year',
    ],
    supportedRowDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.PROJECT,
      BI_RISK_HEATMAP_DIMENSION_KEYS.PORTFOLIO_GROUP,
      BI_RISK_HEATMAP_DIMENSION_KEYS.TIME_BUCKET,
    ],
    supportedColumnDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_LEVEL,
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_CATEGORY,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS.PMO_TRAFFIC_LIGHT,
    unit: 'delta',
    lowerIsBetter: true,
  },
  {
    key: BI_RISK_HEATMAP_METRIC_KEYS.TRAFFIC_LIGHT_RISK_RATIO,
    label: '交通灯风险比',
    sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.PMO_TRAFFIC_LIGHT,
    metricVersion: 'bi-risk-heatmap-v1',
    requiredPermission: 'portfolio:view',
    supportedWindows: ['last_30_days', 'last_90_days', 'last_180_days', 'current_quarter'],
    supportedRowDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.PROJECT,
      BI_RISK_HEATMAP_DIMENSION_KEYS.PORTFOLIO_GROUP,
    ],
    supportedColumnDimensions: [
      BI_RISK_HEATMAP_DIMENSION_KEYS.RISK_LEVEL,
      BI_RISK_HEATMAP_DIMENSION_KEYS.TIME_BUCKET,
    ],
    defaultCompareMode: 'previous_period',
    drilldownTargetKind: BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS.PMO_TRAFFIC_LIGHT,
    unit: 'ratio',
    lowerIsBetter: true,
  },
]

export const BI_RISK_HEATMAP_METRIC_BY_KEY: ReadonlyMap<string, BiRiskHeatmapMetricDefinition> =
  new Map(BI_RISK_HEATMAP_METRIC_REGISTRY.map((def) => [def.key, def]))

export function resolveBiRiskHeatmapMetric(key: string): BiRiskHeatmapMetricDefinition | undefined {
  return BI_RISK_HEATMAP_METRIC_BY_KEY.get(key)
}
