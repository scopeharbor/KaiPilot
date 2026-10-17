// ─── BI 风险热力图共享契约 ──────────────────────────────────────────────────
//
// 本文件定义组织/PMO 级 BI 风险热力图的前后端共享类型、枚举、纯函数与 guard。
// 依赖约束：不导入 AdonisJS、React、数据库客户端、AI SDK、浏览器或第三方运行时。
// 版本：bi-risk-heatmap-v1（2026-07-30）

// ══════════════════════════════════════════════════════════════════════════════
// 枚举值数组（供验证器引用，避免 Vine 对类型表达式的兼容问题）
// ══════════════════════════════════════════════════════════════════════════════

export const BI_RISK_HEATMAP_METRIC_KEY_VALUES = [
  'risk_exposure_score',
  'risk_count',
  'high_risk_ratio',
  'overdue_risk_ratio',
  'risk_delta',
  'traffic_light_risk_ratio',
] as const

export const BI_RISK_HEATMAP_SOURCE_KIND_VALUES = [
  'risk_register',
  'risk_matrix',
  'risk_ai_suggestions',
  'organization_dashboard_risk',
  'pmo_portfolio_dashboard',
  'pmo_portfolio_grouping',
  'pmo_traffic_light',
  'project_health_diagnosis',
  'report_snapshot',
] as const

export const BI_RISK_HEATMAP_DIMENSION_KEY_VALUES = [
  'project',
  'portfolio_group',
  'risk_category',
  'risk_level',
  'risk_status',
  'assignee',
  'time_bucket',
  'department',
] as const

export const BI_RISK_HEATMAP_WINDOW_VALUES = [
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'last_180_days',
  'last_365_days',
  'current_month',
  'current_quarter',
  'current_year',
] as const

export const BI_RISK_HEATMAP_RISK_LEVEL_VALUES = [
  'critical',
  'high',
  'medium',
  'low',
  'none',
] as const

export const BI_RISK_HEATMAP_CELL_RISK_LEVEL_VALUES = [
  'critical',
  'high',
  'medium',
  'low',
  'insufficient_data',
] as const

export const BI_RISK_HEATMAP_COMPARE_MODE_VALUES = [
  'previous_period',
  'same_period_last_year',
  'none',
] as const

export const BI_RISK_HEATMAP_SORT_KEY_VALUES = [
  'score',
  'count',
  'delta',
  'rowDimension',
  'columnDimension',
] as const

export const BI_RISK_HEATMAP_FRESHNESS_STATE_VALUES = ['fresh', 'stale', 'unknown'] as const

export const BI_RISK_HEATMAP_REDACTION_STATE_VALUES = ['none', 'partial', 'full'] as const

export const BI_RISK_HEATMAP_WARNING_CODE_VALUES = [
  'INSUFFICIENT_SAMPLE',
  'MISSING_SOURCE',
  'STALE_SOURCE',
  'DIMENSION_REDACTED',
  'UNSUPPORTED_METRIC',
  'UNSUPPORTED_FINANCIAL_METRIC',
  'UNSUPPORTED_QUERY_COMBINATION',
  'CACHE_DEGRADED',
  'SOURCE_UNAVAILABLE',
  'PARTIAL_DATA',
  'THRESHOLD_BREACHED',
] as const

export const BI_RISK_HEATMAP_DRILLDOWN_TARGET_KIND_VALUES = [
  'project',
  'risk',
  'risk_matrix',
  'pmo_portfolio',
  'pmo_grouping',
  'pmo_traffic_light',
  'organization_dashboard',
  'report',
  'okr',
  'resource',
] as const

export const BI_RISK_HEATMAP_INSIGHT_SEVERITY_VALUES = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const

// ══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════════════════

export type BiRiskHeatmapMetricKey = (typeof BI_RISK_HEATMAP_METRIC_KEY_VALUES)[number]
export type BiRiskHeatmapSourceKind = (typeof BI_RISK_HEATMAP_SOURCE_KIND_VALUES)[number]
export type BiRiskHeatmapDimensionKey = (typeof BI_RISK_HEATMAP_DIMENSION_KEY_VALUES)[number]
export type BiRiskHeatmapWindow = (typeof BI_RISK_HEATMAP_WINDOW_VALUES)[number]
export type BiRiskHeatmapRiskLevel = (typeof BI_RISK_HEATMAP_RISK_LEVEL_VALUES)[number]
export type BiRiskHeatmapCellRiskLevel = (typeof BI_RISK_HEATMAP_CELL_RISK_LEVEL_VALUES)[number]
export type BiRiskHeatmapCompareMode = (typeof BI_RISK_HEATMAP_COMPARE_MODE_VALUES)[number]
export type BiRiskHeatmapSortKey = (typeof BI_RISK_HEATMAP_SORT_KEY_VALUES)[number]
export type BiRiskHeatmapFreshnessState = (typeof BI_RISK_HEATMAP_FRESHNESS_STATE_VALUES)[number]
export type BiRiskHeatmapRedactionState = (typeof BI_RISK_HEATMAP_REDACTION_STATE_VALUES)[number]
export type BiRiskHeatmapWarningCode = (typeof BI_RISK_HEATMAP_WARNING_CODE_VALUES)[number]
export type BiRiskHeatmapDrilldownTargetKind =
  (typeof BI_RISK_HEATMAP_DRILLDOWN_TARGET_KIND_VALUES)[number]
export type BiRiskHeatmapInsightSeverity = (typeof BI_RISK_HEATMAP_INSIGHT_SEVERITY_VALUES)[number]

/** 不支持的财务风险指标键 */
export type BiRiskHeatmapUnsupportedMetricKey =
  'budget_risk' | 'cost_risk' | 'roi_risk' | 'cashflow_risk'

// ══════════════════════════════════════════════════════════════════════════════
// 常量键
// ══════════════════════════════════════════════════════════════════════════════

export const BI_RISK_HEATMAP_METRIC_KEYS = {
  RISK_EXPOSURE_SCORE: 'risk_exposure_score' as BiRiskHeatmapMetricKey,
  RISK_COUNT: 'risk_count' as BiRiskHeatmapMetricKey,
  HIGH_RISK_RATIO: 'high_risk_ratio' as BiRiskHeatmapMetricKey,
  OVERDUE_RISK_RATIO: 'overdue_risk_ratio' as BiRiskHeatmapMetricKey,
  RISK_DELTA: 'risk_delta' as BiRiskHeatmapMetricKey,
  TRAFFIC_LIGHT_RISK_RATIO: 'traffic_light_risk_ratio' as BiRiskHeatmapMetricKey,
} as const

export const BI_RISK_HEATMAP_SOURCE_KINDS = {
  RISK_REGISTER: 'risk_register' as BiRiskHeatmapSourceKind,
  RISK_MATRIX: 'risk_matrix' as BiRiskHeatmapSourceKind,
  RISK_AI_SUGGESTIONS: 'risk_ai_suggestions' as BiRiskHeatmapSourceKind,
  ORGANIZATION_DASHBOARD_RISK: 'organization_dashboard_risk' as BiRiskHeatmapSourceKind,
  PMO_PORTFOLIO_DASHBOARD: 'pmo_portfolio_dashboard' as BiRiskHeatmapSourceKind,
  PMO_PORTFOLIO_GROUPING: 'pmo_portfolio_grouping' as BiRiskHeatmapSourceKind,
  PMO_TRAFFIC_LIGHT: 'pmo_traffic_light' as BiRiskHeatmapSourceKind,
  PROJECT_HEALTH_DIAGNOSIS: 'project_health_diagnosis' as BiRiskHeatmapSourceKind,
  REPORT_SNAPSHOT: 'report_snapshot' as BiRiskHeatmapSourceKind,
} as const

export const BI_RISK_HEATMAP_DIMENSION_KEYS = {
  PROJECT: 'project' as BiRiskHeatmapDimensionKey,
  PORTFOLIO_GROUP: 'portfolio_group' as BiRiskHeatmapDimensionKey,
  RISK_CATEGORY: 'risk_category' as BiRiskHeatmapDimensionKey,
  RISK_LEVEL: 'risk_level' as BiRiskHeatmapDimensionKey,
  RISK_STATUS: 'risk_status' as BiRiskHeatmapDimensionKey,
  ASSIGNEE: 'assignee' as BiRiskHeatmapDimensionKey,
  TIME_BUCKET: 'time_bucket' as BiRiskHeatmapDimensionKey,
  DEPARTMENT: 'department' as BiRiskHeatmapDimensionKey,
} as const

export const BI_RISK_HEATMAP_WINDOWS = {
  LAST_7_DAYS: 'last_7_days' as BiRiskHeatmapWindow,
  LAST_30_DAYS: 'last_30_days' as BiRiskHeatmapWindow,
  LAST_90_DAYS: 'last_90_days' as BiRiskHeatmapWindow,
  LAST_180_DAYS: 'last_180_days' as BiRiskHeatmapWindow,
  LAST_365_DAYS: 'last_365_days' as BiRiskHeatmapWindow,
  CURRENT_MONTH: 'current_month' as BiRiskHeatmapWindow,
  CURRENT_QUARTER: 'current_quarter' as BiRiskHeatmapWindow,
  CURRENT_YEAR: 'current_year' as BiRiskHeatmapWindow,
} as const

export const BI_RISK_HEATMAP_RISK_LEVELS = {
  CRITICAL: 'critical' as BiRiskHeatmapRiskLevel,
  HIGH: 'high' as BiRiskHeatmapRiskLevel,
  MEDIUM: 'medium' as BiRiskHeatmapRiskLevel,
  LOW: 'low' as BiRiskHeatmapRiskLevel,
  NONE: 'none' as BiRiskHeatmapRiskLevel,
} as const

export const BI_RISK_HEATMAP_CELL_RISK_LEVELS = {
  CRITICAL: 'critical' as BiRiskHeatmapCellRiskLevel,
  HIGH: 'high' as BiRiskHeatmapCellRiskLevel,
  MEDIUM: 'medium' as BiRiskHeatmapCellRiskLevel,
  LOW: 'low' as BiRiskHeatmapCellRiskLevel,
  INSUFFICIENT_DATA: 'insufficient_data' as BiRiskHeatmapCellRiskLevel,
} as const

export const BI_RISK_HEATMAP_COMPARE_MODES = {
  PREVIOUS_PERIOD: 'previous_period' as BiRiskHeatmapCompareMode,
  SAME_PERIOD_LAST_YEAR: 'same_period_last_year' as BiRiskHeatmapCompareMode,
  NONE: 'none' as BiRiskHeatmapCompareMode,
} as const

export const BI_RISK_HEATMAP_SORT_KEYS = {
  SCORE: 'score' as BiRiskHeatmapSortKey,
  COUNT: 'count' as BiRiskHeatmapSortKey,
  DELTA: 'delta' as BiRiskHeatmapSortKey,
  ROW_DIMENSION: 'rowDimension' as BiRiskHeatmapSortKey,
  COLUMN_DIMENSION: 'columnDimension' as BiRiskHeatmapSortKey,
} as const

export const BI_RISK_HEATMAP_FRESHNESS_STATES = {
  FRESH: 'fresh' as BiRiskHeatmapFreshnessState,
  STALE: 'stale' as BiRiskHeatmapFreshnessState,
  UNKNOWN: 'unknown' as BiRiskHeatmapFreshnessState,
} as const

export const BI_RISK_HEATMAP_REDACTION_STATES = {
  NONE: 'none' as BiRiskHeatmapRedactionState,
  PARTIAL: 'partial' as BiRiskHeatmapRedactionState,
  FULL: 'full' as BiRiskHeatmapRedactionState,
} as const

export const BI_RISK_HEATMAP_WARNING_CODES = {
  INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE' as BiRiskHeatmapWarningCode,
  MISSING_SOURCE: 'MISSING_SOURCE' as BiRiskHeatmapWarningCode,
  STALE_SOURCE: 'STALE_SOURCE' as BiRiskHeatmapWarningCode,
  DIMENSION_REDACTED: 'DIMENSION_REDACTED' as BiRiskHeatmapWarningCode,
  UNSUPPORTED_METRIC: 'UNSUPPORTED_METRIC' as BiRiskHeatmapWarningCode,
  UNSUPPORTED_FINANCIAL_METRIC: 'UNSUPPORTED_FINANCIAL_METRIC' as BiRiskHeatmapWarningCode,
  UNSUPPORTED_QUERY_COMBINATION: 'UNSUPPORTED_QUERY_COMBINATION' as BiRiskHeatmapWarningCode,
  CACHE_DEGRADED: 'CACHE_DEGRADED' as BiRiskHeatmapWarningCode,
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE' as BiRiskHeatmapWarningCode,
  PARTIAL_DATA: 'PARTIAL_DATA' as BiRiskHeatmapWarningCode,
  THRESHOLD_BREACHED: 'THRESHOLD_BREACHED' as BiRiskHeatmapWarningCode,
} as const

export const BI_RISK_HEATMAP_DRILLDOWN_TARGET_KINDS = {
  PROJECT: 'project' as BiRiskHeatmapDrilldownTargetKind,
  RISK: 'risk' as BiRiskHeatmapDrilldownTargetKind,
  RISK_MATRIX: 'risk_matrix' as BiRiskHeatmapDrilldownTargetKind,
  PMO_PORTFOLIO: 'pmo_portfolio' as BiRiskHeatmapDrilldownTargetKind,
  PMO_GROUPING: 'pmo_grouping' as BiRiskHeatmapDrilldownTargetKind,
  PMO_TRAFFIC_LIGHT: 'pmo_traffic_light' as BiRiskHeatmapDrilldownTargetKind,
  ORGANIZATION_DASHBOARD: 'organization_dashboard' as BiRiskHeatmapDrilldownTargetKind,
  REPORT: 'report' as BiRiskHeatmapDrilldownTargetKind,
  OKR: 'okr' as BiRiskHeatmapDrilldownTargetKind,
  RESOURCE: 'resource' as BiRiskHeatmapDrilldownTargetKind,
} as const

export const BI_RISK_HEATMAP_INSIGHT_SEVERITIES = {
  CRITICAL: 'critical' as BiRiskHeatmapInsightSeverity,
  HIGH: 'high' as BiRiskHeatmapInsightSeverity,
  MEDIUM: 'medium' as BiRiskHeatmapInsightSeverity,
  LOW: 'low' as BiRiskHeatmapInsightSeverity,
  INFO: 'info' as BiRiskHeatmapInsightSeverity,
} as const

// ══════════════════════════════════════════════════════════════════════════════
// 默认值
// ══════════════════════════════════════════════════════════════════════════════

export const BI_RISK_HEATMAP_DEFAULT_WINDOW: BiRiskHeatmapWindow = 'last_90_days'
export const BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION: BiRiskHeatmapDimensionKey = 'project'
export const BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION: BiRiskHeatmapDimensionKey = 'risk_level'
export const BI_RISK_HEATMAP_DEFAULT_PER_PAGE = 50
export const BI_RISK_HEATMAP_MAX_PER_PAGE = 200
export const BI_RISK_HEATMAP_METRIC_VERSION = 'bi-risk-heatmap-v1'
export const BI_RISK_HEATMAP_MIN_SAMPLE_COUNT = 3
export const BI_RISK_HEATMAP_MAX_CONTRIBUTORS = 5
export const BI_RISK_HEATMAP_MAX_CELLS = 500
export const BI_RISK_HEATMAP_MAX_FILTERS = 10

// ══════════════════════════════════════════════════════════════════════════════
// 接口
// ══════════════════════════════════════════════════════════════════════════════

/** 筛选形态 */
export interface BiRiskHeatmapFilters {
  projectIds?: string[]
  departments?: string[]
  portfolioGroups?: string[]
  riskCategories?: string[]
  riskLevels?: BiRiskHeatmapRiskLevel[]
  riskStatuses?: string[]
  assigneeIds?: string[]
}

/** 时间窗口天数映射 */
export const BI_RISK_HEATMAP_WINDOW_DAYS: Record<BiRiskHeatmapWindow, number> = {
  last_7_days: 7,
  last_30_days: 30,
  last_90_days: 90,
  last_180_days: 180,
  last_365_days: 365,
  current_month: 31,
  current_quarter: 92,
  current_year: 366,
}

/** 查询输入 */
export interface BiRiskHeatmapQuery {
  metricKey: BiRiskHeatmapMetricKey
  window: BiRiskHeatmapWindow
  rowDimension: BiRiskHeatmapDimensionKey
  columnDimension: BiRiskHeatmapDimensionKey
  filters?: BiRiskHeatmapFilters
  compareWith?: BiRiskHeatmapCompareMode
  sort?: BiRiskHeatmapSortKey
  sortDir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

/** 查询形态（审计/验证用） */
export interface BiRiskHeatmapQueryShape {
  metricKey: BiRiskHeatmapMetricKey
  window: BiRiskHeatmapWindow
  rowDimension: BiRiskHeatmapDimensionKey
  columnDimension: BiRiskHeatmapDimensionKey
  filterCount: number
  compareWith: BiRiskHeatmapCompareMode
  sort: BiRiskHeatmapSortKey
  sortDir: 'asc' | 'desc'
  page: number
  perPage: number
}

/** 来源引用 */
export interface BiRiskHeatmapSourceRef {
  sourceKind: BiRiskHeatmapSourceKind
  state: BiRiskHeatmapFreshnessState
  lastRefreshedAt: string | null
  metricVersion: string
}

/** 来源 freshness */
export interface BiRiskHeatmapFreshness {
  state: BiRiskHeatmapFreshnessState
  sourceCoverage: number
  freshnessHash: string
  sources: BiRiskHeatmapSourceRef[]
}

/** 证据引用（低敏） */
export interface BiRiskHeatmapEvidenceRef {
  kind: string
  label: string
  targetKind: BiRiskHeatmapDrilldownTargetKind
  sourceKind: BiRiskHeatmapSourceKind
}

/** Warning */
export interface BiRiskHeatmapWarning {
  code: BiRiskHeatmapWarningCode
  message: string
  context?: Record<string, unknown>
}

/** 贡献者 */
export interface BiRiskHeatmapContributor {
  id: string
  label: string
  kind: BiRiskHeatmapDrilldownTargetKind
  contributionWeight: number
  rank: number
}

/** 安全下钻目标 */
export interface BiRiskHeatmapDrilldownTarget {
  kind: BiRiskHeatmapDrilldownTargetKind
  targetId?: string | number
  label: string
  route?: string
  requiresPermission: string | null
}

/** Advisory insight */
export interface BiRiskHeatmapInsight {
  severity: BiRiskHeatmapInsightSeverity
  summary: string
  possibleCauses: string[]
  suggestedDrilldowns: BiRiskHeatmapDrilldownTarget[]
  confidence: number
  dataQualityWarning: string | null
}

/** 热力 cell */
export interface BiRiskHeatmapCell {
  rowKey: string
  rowLabel: string
  columnKey: string
  columnLabel: string
  score: number
  riskLevel: BiRiskHeatmapCellRiskLevel
  count: number
  delta: number | null
  confidence: number
  contributors: BiRiskHeatmapContributor[]
  redactionState: BiRiskHeatmapRedactionState
  warnings: BiRiskHeatmapWarning[]
  evidenceRefs: BiRiskHeatmapEvidenceRef[]
  sampleCount: number
  drilldownTargets: BiRiskHeatmapDrilldownTarget[]
}

/** 响应 */
export interface BiRiskHeatmapResponse {
  data: BiRiskHeatmapCell[]
  meta: BiRiskHeatmapResponseMeta
  warnings: BiRiskHeatmapWarning[]
  queryShape: BiRiskHeatmapQueryShape
  calculatedAt: string
}

/** 响应 meta */
export interface BiRiskHeatmapResponseMeta {
  organizationId: number
  calculatedAt: string
  metricVersion: string
  queryShape: BiRiskHeatmapQueryShape
  freshness: BiRiskHeatmapFreshness
  page: number
  perPage: number
  total: number
  totalPages: number
}

// ══════════════════════════════════════════════════════════════════════════════
// Guard helpers —— 白名单校验
// ══════════════════════════════════════════════════════════════════════════════

export function isSupportedBiRiskHeatmapMetricKey(key: string): key is BiRiskHeatmapMetricKey {
  return BI_RISK_HEATMAP_METRIC_KEY_VALUES.includes(key as BiRiskHeatmapMetricKey)
}

export function isSupportedBiRiskHeatmapDimensionKey(
  key: string,
): key is BiRiskHeatmapDimensionKey {
  return BI_RISK_HEATMAP_DIMENSION_KEY_VALUES.includes(key as BiRiskHeatmapDimensionKey)
}

export function isSupportedBiRiskHeatmapWindow(key: string): key is BiRiskHeatmapWindow {
  return BI_RISK_HEATMAP_WINDOW_VALUES.includes(key as BiRiskHeatmapWindow)
}

export function isSupportedBiRiskHeatmapCompareMode(key: string): key is BiRiskHeatmapCompareMode {
  return BI_RISK_HEATMAP_COMPARE_MODE_VALUES.includes(key as BiRiskHeatmapCompareMode)
}

export function isSupportedBiRiskHeatmapSortKey(key: string): key is BiRiskHeatmapSortKey {
  return BI_RISK_HEATMAP_SORT_KEY_VALUES.includes(key as BiRiskHeatmapSortKey)
}

export function isUnsupportedFinancialRiskMetricKey(key: string): boolean {
  return ['budget_risk', 'cost_risk', 'roi_risk', 'cashflow_risk'].includes(key)
}

export function isBiRiskHeatmapWindowWithinBounds(window: BiRiskHeatmapWindow): boolean {
  return window in BI_RISK_HEATMAP_WINDOW_DAYS
}

export function isBiRiskHeatmapCellCountWithinLimit(count: number): boolean {
  return count <= BI_RISK_HEATMAP_MAX_CELLS
}

export function isBiRiskHeatmapFilterCountWithinLimit(count: number): boolean {
  return count <= BI_RISK_HEATMAP_MAX_FILTERS
}

// ══════════════════════════════════════════════════════════════════════════════
// 确定性 pure helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cell key 规范化 —— 生成稳定的行×列 key。
 */
export function normalizeBiRiskHeatmapCellKey(rowKey: string, columnKey: string): string {
  return `${rowKey}::${columnKey}`
}

/**
 * 将维度值归一化为统一 key。
 */
export function normalizeBiRiskHeatmapDimensionValue(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * 概率/影响/严重度/状态加权 —— 计算 cell score。
 *
 * 公式: score = probabilityWeight * impactWeight * severityWeight * statusWeight
 * 返回 [0, 1] 归一化值。
 */
export function computeBiRiskHeatmapCellScore(params: {
  probability: number
  impact: number
  severityWeight: number
  statusWeight: number
}): number {
  const { probability, impact, severityWeight, statusWeight } = params
  const clampedProb = Math.max(0, Math.min(1, probability))
  const clampedImpact = Math.max(0, Math.min(1, impact))
  const raw = clampedProb * clampedImpact * severityWeight * statusWeight
  return Math.round(raw * 10000) / 10000
}

/**
 * 风险等级分类 —— 将 cell score 映射为风险等级。
 */
export function classifyBiRiskHeatmapCellLevel(
  score: number,
  sampleCount: number,
): BiRiskHeatmapCellRiskLevel {
  if (sampleCount < BI_RISK_HEATMAP_MIN_SAMPLE_COUNT) return 'insufficient_data'
  if (score >= 0.8) return 'critical'
  if (score >= 0.5) return 'high'
  if (score >= 0.25) return 'medium'
  return 'low'
}

/**
 * Delta 计算 —— 对比两期 cell score。
 */
export function computeBiRiskHeatmapDelta(
  currentScore: number,
  previousScore: number | null,
): number | null {
  if (previousScore === null || previousScore === undefined) return null
  return Math.round((currentScore - previousScore) * 10000) / 10000
}

/**
 * Confidence 计算 —— 基于样本数和来源覆盖度。
 */
export function computeBiRiskHeatmapConfidence(params: {
  sampleCount: number
  sourceCoverage: number
  minSampleCount?: number
}): number {
  const { sampleCount, sourceCoverage, minSampleCount = BI_RISK_HEATMAP_MIN_SAMPLE_COUNT } = params
  const sampleFactor = Math.min(1, sampleCount / (minSampleCount * 3))
  const coverageFactor = Math.max(0, Math.min(1, sourceCoverage))
  return Math.round((sampleFactor * 0.7 + coverageFactor * 0.3) * 100) / 100
}

/**
 * Top contributor 截断。
 */
export function truncateBiRiskHeatmapContributors(
  contributors: BiRiskHeatmapContributor[],
  maxContributors: number = BI_RISK_HEATMAP_MAX_CONTRIBUTORS,
): BiRiskHeatmapContributor[] {
  const sorted = [...contributors].sort((a, b) => b.contributionWeight - a.contributionWeight)
  return sorted.slice(0, maxContributors).map((c, i) => ({ ...c, rank: i + 1 }))
}

// ══════════════════════════════════════════════════════════════════════════════
// Warning / Redaction helpers
// ══════════════════════════════════════════════════════════════════════════════

export function buildBiRiskHeatmapWarning(
  code: BiRiskHeatmapWarningCode,
  message: string,
  context?: Record<string, unknown>,
): BiRiskHeatmapWarning {
  return { code, message, context }
}

export function isBiRiskHeatmapRedacted(state: BiRiskHeatmapRedactionState): boolean {
  return state === 'partial' || state === 'full'
}

export function redactBiRiskHeatmapEvidence(
  evidence: BiRiskHeatmapEvidenceRef[],
  redactionState: BiRiskHeatmapRedactionState,
): BiRiskHeatmapEvidenceRef[] {
  if (redactionState === 'none') return evidence
  if (redactionState === 'full') return []
  return evidence.map((e) => ({
    ...e,
    label: '[已脱敏]',
  }))
}

// ══════════════════════════════════════════════════════════════════════════════
// Query shape helpers
// ══════════════════════════════════════════════════════════════════════════════

export function buildBiRiskHeatmapQueryShape(query: BiRiskHeatmapQuery): BiRiskHeatmapQueryShape {
  const filterCount = [
    query.filters?.projectIds?.length ?? 0,
    query.filters?.departments?.length ?? 0,
    query.filters?.portfolioGroups?.length ?? 0,
    query.filters?.riskCategories?.length ?? 0,
    query.filters?.riskLevels?.length ?? 0,
    query.filters?.riskStatuses?.length ?? 0,
    query.filters?.assigneeIds?.length ?? 0,
  ].reduce((a, b) => a + b, 0)

  return {
    metricKey: query.metricKey,
    window: query.window,
    rowDimension: query.rowDimension,
    columnDimension: query.columnDimension,
    filterCount,
    compareWith: query.compareWith ?? BI_RISK_HEATMAP_COMPARE_MODES.NONE,
    sort: query.sort ?? BI_RISK_HEATMAP_SORT_KEYS.SCORE,
    sortDir: query.sortDir ?? 'desc',
    page: query.page ?? 1,
    perPage: query.perPage ?? BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
  }
}

/**
 * 序列化查询为审计用稳定字符串。
 */
export function serializeBiRiskHeatmapQuery(query: BiRiskHeatmapQuery): string {
  const parts = [
    `metric=${query.metricKey}`,
    `window=${query.window}`,
    `row=${query.rowDimension}`,
    `col=${query.columnDimension}`,
  ]
  if (query.filters) {
    const f = query.filters
    if (f.projectIds?.length) parts.push(`projects=${f.projectIds.join('.')}`)
    if (f.departments?.length) parts.push(`depts=${f.departments.join('.')}`)
    if (f.portfolioGroups?.length) parts.push(`groups=${f.portfolioGroups.join('.')}`)
    if (f.riskCategories?.length) parts.push(`cats=${f.riskCategories.join('.')}`)
    if (f.riskLevels?.length) parts.push(`levels=${f.riskLevels.join('.')}`)
  }
  return parts.join('&')
}

/**
 * 简单哈希（非加密用途）。
 */
export function simpleBiRiskHeatmapHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `rh_${Math.abs(hash).toString(16)}`
}

// ══════════════════════════════════════════════════════════════════════════════
// Freshness aggregation
// ══════════════════════════════════════════════════════════════════════════════

export function aggregateBiRiskHeatmapFreshness(
  sources: BiRiskHeatmapSourceRef[],
): BiRiskHeatmapFreshness {
  if (sources.length === 0) {
    return {
      state: 'unknown',
      sourceCoverage: 0,
      freshnessHash: 'no-sources',
      sources: [],
    }
  }

  const stateCounts: Record<string, number> = { fresh: 0, stale: 0, unknown: 0 }
  for (const s of sources) {
    const key = s.state
    stateCounts[key] = (stateCounts[key] ?? 0) + 1
  }

  const freshCount: number = stateCounts['fresh'] ?? 0
  const staleCount: number = stateCounts['stale'] ?? 0
  const unknownCount: number = stateCounts['unknown'] ?? 0

  let state: BiRiskHeatmapFreshnessState = 'fresh'
  if (staleCount > 0 && staleCount >= freshCount) {
    state = 'stale'
  }
  if (unknownCount === sources.length) {
    state = 'unknown'
  }

  const sourceCoverage = sources.length / BI_RISK_HEATMAP_SOURCE_KIND_VALUES.length
  const hashInput = sources.map((s) => `${s.sourceKind}:${s.state}`).join('|')
  const freshnessHash = simpleBiRiskHeatmapHash(hashInput)

  return { state, sourceCoverage, freshnessHash, sources }
}

// ══════════════════════════════════════════════════════════════════════════════
// 不支持的查询组合检测
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 检测行列维度组合是否无效（相同维度不能同时作为行和列）。
 */
export function isBiRiskHeatmapDimensionPairUnsafe(
  rowDim: BiRiskHeatmapDimensionKey,
  colDim: BiRiskHeatmapDimensionKey,
): boolean {
  return rowDim === colDim
}
