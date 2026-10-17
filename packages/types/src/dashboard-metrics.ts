// @aiproj/types — Dashboard 指标字典与对账契约（前后端共享）。

/** Dashboard 指标 key 枚举。 */
export const DASHBOARD_METRIC_KEYS = {
  PROGRESS_PERCENT: 'progress_percent',
  HEALTH_STATUS: 'health_status',
  TASK_STATUS_DISTRIBUTION: 'task_status_distribution',
  TASK_TOTAL: 'task_total',
  OVERDUE_TASK_COUNT: 'overdue_task_count',
  SOON_DUE_TASK_COUNT: 'soon_due_task_count',
  MEMBER_COUNT: 'member_count',
  MILESTONE_STATUS_DISTRIBUTION: 'milestone_status_distribution',
  MILESTONE_TOTAL: 'milestone_total',
  REMAINING_DAYS: 'remaining_days',
  RECENT_ACTIVITY_SUMMARY: 'recent_activity_summary',
  // V2 风险指标
  RISK_TOTAL: 'risk_total',
  HIGH_RISK_COUNT: 'high_risk_count',
  CRITICAL_RISK_COUNT: 'critical_risk_count',
  OVERDUE_RISK_REVIEW_COUNT: 'overdue_risk_review_count',
  RISK_HEALTH_SCORE: 'risk_health_score',
} as const

export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[keyof typeof DASHBOARD_METRIC_KEYS]

/** 指标值单位。 */
export type DashboardMetricUnit =
  'percent' | 'count' | 'days' | 'status' | 'distribution' | 'summary' | string

/** 指标数据来源。 */
export const DASHBOARD_SOURCES = {
  PROJECT_FIELD: 'project_field',
  TASK_AGGREGATION: 'task_aggregation',
  MEMBER_AGGREGATION: 'member_aggregation',
  MILESTONE_AGGREGATION: 'milestone_aggregation',
  AUDIT_LOG_AGGREGATION: 'audit_log_aggregation',
  RISK_AGGREGATION: 'risk_aggregation',
} as const

export type DashboardSource = (typeof DASHBOARD_SOURCES)[keyof typeof DASHBOARD_SOURCES]

/** 指标状态。 */
export const DASHBOARD_STATUSES = {
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  MISMATCH: 'mismatch',
} as const

export type DashboardMetricStatus = (typeof DASHBOARD_STATUSES)[keyof typeof DASHBOARD_STATUSES]

/** 单个规范化指标。 */
export interface DashboardMetric {
  key: DashboardMetricKey
  value: number | string | Record<string, number> | null
  unit: DashboardMetricUnit
  source: DashboardSource
  status: DashboardMetricStatus
  breakdown?: Record<string, number>
}

/** Warning code 枚举。 */
export const DASHBOARD_WARNING_CODES = {
  PROJECT_DATE_MISSING: 'PROJECT_DATE_MISSING',
  TASK_METRIC_EMPTY: 'TASK_METRIC_EMPTY',
  MILESTONE_METRIC_EMPTY: 'MILESTONE_METRIC_EMPTY',
  AUDIT_LOG_UNAVAILABLE: 'AUDIT_LOG_UNAVAILABLE',
  METRIC_RECONCILIATION_MISMATCH: 'METRIC_RECONCILIATION_MISMATCH',
  RISK_METRIC_EMPTY: 'RISK_METRIC_EMPTY',
} as const

export type DashboardWarningCode =
  (typeof DASHBOARD_WARNING_CODES)[keyof typeof DASHBOARD_WARNING_CODES]

/** Dashboard warning。 */
export interface DashboardWarning {
  code: DashboardWarningCode
  message: string
  metricKey?: DashboardMetricKey
}

/** Dashboard 指标元数据。 */
export interface DashboardMeta {
  calculatedAt: string
  metricVersion: string
  projectId: number
  organizationId: number
}

/** V1 指标口径版本。 */
export const DASHBOARD_METRIC_VERSION_V1 = 'project-dashboard.v1' as const

/** V1 即将到期窗口（自然日）。 */
export const SOON_DUE_WINDOW_DAYS = 7

/** 默认最大活动数。 */
export const DASHBOARD_MAX_RECENT_ACTIVITY = 20
