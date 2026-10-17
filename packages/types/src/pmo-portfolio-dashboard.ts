// @aiproj/types — PMO 组合 Dashboard 共享契约（前后端共享）。
// v3-pmo-portfolio-dashboard §2: metric catalogue, DTOs, warnings, constants, helpers.

// ─── Metric Keys ───────────────────────────────────────────────────────────────

export const PORTFOLIO_DASHBOARD_METRIC_KEYS = {
  // 组合 KPI
  TOTAL_PROJECTS: 'total_projects',
  ACTIVE_PROJECTS: 'active_projects',
  ARCHIVED_PROJECTS: 'archived_projects',
  AT_RISK_PROJECTS: 'at_risk_projects',
  BLOCKED_PROJECTS: 'blocked_projects',

  // 交付指标
  DELIVERY_ON_TRACK_PERCENT: 'delivery_on_track_percent',
  OVERALL_PROGRESS_AVG: 'overall_progress_avg',
  OVERDUE_PROJECT_PERCENT: 'overdue_project_percent',
  OVERDUE_TASK_PERCENT: 'overdue_task_percent',

  // 健康/风险/资源/预测压力
  HEALTH_RED_PERCENT: 'health_red_percent',
  HEALTH_YELLOW_PERCENT: 'health_yellow_percent',
  HEALTH_GREEN_PERCENT: 'health_green_percent',
  RISK_HIGH_PERCENT: 'risk_high_percent',
  RISK_CRITICAL_COUNT: 'risk_critical_count',
  RESOURCE_OVERLOAD_PERCENT: 'resource_overload_percent',
  PREDICTION_HIGH_SEVERITY_PERCENT: 'prediction_high_severity_percent',

  // 数据质量
  SOURCE_FRESHNESS_STALE_PERCENT: 'source_freshness_stale_percent',
  METRIC_UNAVAILABLE_COUNT: 'metric_unavailable_count',

  // 交通灯
  TRAFFIC_LIGHT_RED_COUNT: 'traffic_light_red_count',
  TRAFFIC_LIGHT_YELLOW_COUNT: 'traffic_light_yellow_count',
  TRAFFIC_LIGHT_GREEN_COUNT: 'traffic_light_green_count',
  TRAFFIC_LIGHT_GRAY_COUNT: 'traffic_light_gray_count',
} as const

export type PortfolioDashboardMetricKey =
  (typeof PORTFOLIO_DASHBOARD_METRIC_KEYS)[keyof typeof PORTFOLIO_DASHBOARD_METRIC_KEYS]

/** 指标值单位。 */
export type PortfolioDashboardMetricUnit =
  'count' | 'percent' | 'avg' | 'distribution' | 'status' | string

/** 指标数据来源。 */
export const PORTFOLIO_DASHBOARD_SOURCES = {
  PROJECT_DASHBOARD: 'project_dashboard',
  HEALTH_DIAGNOSIS: 'health_diagnosis',
  PREDICTION: 'prediction',
  RISK_SUMMARY: 'risk_summary',
  RESOURCE_SUMMARY: 'resource_summary',
  TRAFFIC_LIGHT: 'traffic_light',
  COMPUTED: 'computed',
} as const

export type PortfolioDashboardSource =
  (typeof PORTFOLIO_DASHBOARD_SOURCES)[keyof typeof PORTFOLIO_DASHBOARD_SOURCES]

/** 单个组合指标。 */
export interface PortfolioDashboardMetric {
  key: PortfolioDashboardMetricKey
  value: number | null
  unit: PortfolioDashboardMetricUnit
  source: PortfolioDashboardSource
  status: PortfolioDashboardMetricStatus
  breakdown?: Record<string, number>
  warnings?: PortfolioDashboardWarning[]
}

/** 指标状态。 */
export const PORTFOLIO_DASHBOARD_METRIC_STATUSES = {
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  STALE: 'stale',
  UNSUPPORTED: 'unsupported',
} as const

export type PortfolioDashboardMetricStatus =
  (typeof PORTFOLIO_DASHBOARD_METRIC_STATUSES)[keyof typeof PORTFOLIO_DASHBOARD_METRIC_STATUSES]

// ─── Warnings ──────────────────────────────────────────────────────────────────

export const PORTFOLIO_DASHBOARD_WARNING_CODES = {
  METRIC_UNAVAILABLE: 'METRIC_UNAVAILABLE',
  METRIC_FORBIDDEN: 'METRIC_FORBIDDEN',
  METRIC_STALE: 'METRIC_STALE',
  METRIC_EMPTY: 'METRIC_EMPTY',
  TRAFFIC_LIGHT_UNAVAILABLE: 'TRAFFIC_LIGHT_UNAVAILABLE',
  TRAFFIC_LIGHT_FORBIDDEN: 'TRAFFIC_LIGHT_FORBIDDEN',
  FINANCIAL_UNSUPPORTED: 'FINANCIAL_UNSUPPORTED',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  SOURCE_STALE: 'SOURCE_STALE',
} as const

export type PortfolioDashboardWarningCode =
  (typeof PORTFOLIO_DASHBOARD_WARNING_CODES)[keyof typeof PORTFOLIO_DASHBOARD_WARNING_CODES]

/** Dashboard warning。 */
export interface PortfolioDashboardWarning {
  code: PortfolioDashboardWarningCode
  message: string
  metricKey?: PortfolioDashboardMetricKey
}

// ─── Source Freshness ──────────────────────────────────────────────────────────

export interface PortfolioSourceFreshness {
  source: PortfolioDashboardSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
}

// ─── Summary Response ──────────────────────────────────────────────────────────

export interface PortfolioDashboardSummary {
  meta: PortfolioDashboardMeta
  kpis: PortfolioDashboardMetric[]
  trafficLight?: PortfolioTrafficLightBlock | null
  freshness: PortfolioSourceFreshness[]
  warnings: PortfolioDashboardWarning[]
}

export interface PortfolioDashboardMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  visibleProjectCount: number
  totalProjectCount: number
}

export interface PortfolioTrafficLightBlock {
  available: boolean
  forbidden: boolean
  redCount: number
  yellowCount: number
  greenCount: number
  grayCount: number
  warnings: PortfolioDashboardWarning[]
}

// ─── Project List Item ─────────────────────────────────────────────────────────

export interface PortfolioProjectItem {
  projectId: number
  projectName: string
  projectStatus: string
  healthStatus: string
  progressPercent: number
  overdueTaskCount: number
  soonDueTaskCount: number
  memberCount: number
  trafficLightColor?: string | null
  warnings: PortfolioDashboardWarning[]
}

export interface PortfolioProjectListResponse {
  data: PortfolioProjectItem[]
  meta: PortfolioDashboardPaginationMeta
}

// ─── Group Slice ───────────────────────────────────────────────────────────────

export const PORTFOLIO_GROUP_KEYS = {
  STATUS: 'status',
  HEALTH: 'health',
  CATEGORY: 'category',
} as const

export type PortfolioGroupKey = (typeof PORTFOLIO_GROUP_KEYS)[keyof typeof PORTFOLIO_GROUP_KEYS]

export interface PortfolioGroupSlice {
  groupKey: PortfolioGroupKey
  groupValue: string
  projectCount: number
  kpis: PortfolioDashboardMetric[]
  warnings: PortfolioDashboardWarning[]
}

export interface PortfolioGroupSliceResponse {
  data: PortfolioGroupSlice[]
  meta: PortfolioDashboardPaginationMeta
}

// ─── Trend Buckets ─────────────────────────────────────────────────────────────

export const PORTFOLIO_TREND_WINDOWS = {
  LAST_30_DAYS: 'last_30_days',
  LAST_90_DAYS: 'last_90_days',
} as const

export type PortfolioTrendWindow =
  (typeof PORTFOLIO_TREND_WINDOWS)[keyof typeof PORTFOLIO_TREND_WINDOWS]

export interface PortfolioTrendBucket {
  window: PortfolioTrendWindow
  label: string
  startDate: string
  endDate: string
  kpis: PortfolioDashboardMetric[]
  warnings: PortfolioDashboardWarning[]
}

export interface PortfolioTrendResponse {
  data: PortfolioTrendBucket[]
  meta: PortfolioDashboardPaginationMeta
}

// ─── Attention Project ─────────────────────────────────────────────────────────

export const PORTFOLIO_SORT_KEYS = {
  NAME: 'name',
  PROGRESS: 'progress',
  HEALTH: 'health',
  OVERDUE: 'overdue',
  MEMBER_COUNT: 'member_count',
  TRAFFIC_LIGHT: 'traffic_light',
  UPDATED_AT: 'updated_at',
  CREATED_AT: 'created_at',
} as const

export type PortfolioSortKey = (typeof PORTFOLIO_SORT_KEYS)[keyof typeof PORTFOLIO_SORT_KEYS]

export interface PortfolioAttentionProject {
  projectId: number
  projectName: string
  sortKey: PortfolioSortKey
  sortValue: string | number
  warnings: PortfolioDashboardWarning[]
}

// ─── Metric Detail ─────────────────────────────────────────────────────────────

export interface PortfolioMetricDetail {
  metric: PortfolioDashboardMetric
  projectBreakdown: Array<{
    projectId: number
    projectName: string
    value: number | null
    status: PortfolioDashboardMetricStatus
  }>
  freshness: PortfolioSourceFreshness
  warnings: PortfolioDashboardWarning[]
}

// ─── Pagination ────────────────────────────────────────────────────────────────

export interface PortfolioDashboardPaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
}

// ─── Query Types ───────────────────────────────────────────────────────────────

export interface PortfolioDashboardSummaryQuery {
  includeTrafficLight?: boolean
  includeFreshness?: boolean
}

export interface PortfolioProjectListQuery {
  page?: number
  perPage?: number
  sort?: PortfolioSortKey
  order?: 'asc' | 'desc'
  filterStatus?: string
  filterHealth?: string
  search?: string
}

export interface PortfolioGroupSliceQuery {
  groupBy: PortfolioGroupKey
  page?: number
  perPage?: number
  sort?: PortfolioSortKey
  order?: 'asc' | 'desc'
}

export interface PortfolioTrendQuery {
  window: PortfolioTrendWindow
  page?: number
  perPage?: number
}

export interface PortfolioMetricDetailQuery {
  metricKey: PortfolioDashboardMetricKey
  page?: number
  perPage?: number
}

// ─── Metric Version ────────────────────────────────────────────────────────────

export const PORTFOLIO_DASHBOARD_METRIC_VERSION = 'portfolio-dashboard.v1' as const

// ─── Constants ─────────────────────────────────────────────────────────────────

export const PORTFOLIO_DASHBOARD_MAX_PER_PAGE = 100
export const PORTFOLIO_DASHBOARD_DEFAULT_PER_PAGE = 20
export const PORTFOLIO_DASHBOARD_MAX_GROUP_CARDINALITY = 50
export const PORTFOLIO_DASHBOARD_STALE_THRESHOLD_MINUTES = 60

// ─── Contract Helpers ──────────────────────────────────────────────────────────

/** 判断指标是否低敏（不泄露受限数据）。 */
export function isLowSensitiveMetricKey(_key: PortfolioDashboardMetricKey): boolean {
  // 所有组合级指标均为低敏聚合，不泄露单项目敏感细节
  return true
}

/** 投影不支持的财务指标为 UNSUPPORTED warning。 */
export function projectUnsupportedFinancialWarning(
  _metricKey: PortfolioDashboardMetricKey,
): PortfolioDashboardWarning {
  return {
    code: PORTFOLIO_DASHBOARD_WARNING_CODES.FINANCIAL_UNSUPPORTED,
    message: '财务/预算/ROI 指标不在当前范围',
    metricKey: _metricKey,
  }
}

/** 投影 traffic-light 不可用 warning。 */
export function projectTrafficLightUnavailableWarning(): PortfolioDashboardWarning {
  return {
    code: PORTFOLIO_DASHBOARD_WARNING_CODES.TRAFFIC_LIGHT_UNAVAILABLE,
    message: 'PMO 交通灯能力未启用或尚未实现',
  }
}

/** 投影 traffic-light 无权限 warning。 */
export function projectTrafficLightForbiddenWarning(): PortfolioDashboardWarning {
  return {
    code: PORTFOLIO_DASHBOARD_WARNING_CODES.TRAFFIC_LIGHT_FORBIDDEN,
    message: '当前用户无 PMO 交通灯查看权限',
  }
}

/** 投影权限脱敏 warning。 */
export function projectPermissionRedactedWarning(
  metricKey: PortfolioDashboardMetricKey,
): PortfolioDashboardWarning {
  return {
    code: PORTFOLIO_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED,
    message: `指标 ${metricKey} 因权限不足已脱敏`,
    metricKey,
  }
}

/** 检测 source freshness 是否过期。 */
export function isSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number = PORTFOLIO_DASHBOARD_STALE_THRESHOLD_MINUTES,
): boolean {
  if (!lastUpdatedAt) return true
  const last = new Date(lastUpdatedAt).getTime()
  const now = Date.now()
  return now - last > thresholdMinutes * 60 * 1000
}

/** 安全投影：将 forbidden/unavailable 指标替换为 redacted summary。 */
export function projectRedactedMetric(key: PortfolioDashboardMetricKey): PortfolioDashboardMetric {
  return {
    key,
    value: null,
    unit: 'count',
    source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
    status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN,
    warnings: [projectPermissionRedactedWarning(key)],
  }
}
