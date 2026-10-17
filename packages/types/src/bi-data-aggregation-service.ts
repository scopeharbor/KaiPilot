// @aiproj/types —— BI 数据聚合服务共享契约（前后端共享）。
// v3-bi-data-aggregation-service §2：metric key、dimension key、source key、scope、
// time window、grain、filter、sort、pagination、query shape、result row/series、
// dimension bucket、comparison、source freshness、provenance、redaction state、
// warning/error code、cache policy、metricVersion、sourceHash、snapshotHash、
// stable hash 以及零运行时依赖的纯函数。
//
// 红线：
//   - 只读底座：契约不携带任何写入语义；聚合服务只消费授权事实，不重算上游核心算法。
//   - 零依赖：本文件不得 import AdonisJS、React、数据库客户端、AI SDK 或第三方运行时。
//   - 白名单控制：请求参数只接受注册过的 key，不接受 SQL、公式、脚本、未注册字段。
//   - 权限受限维度只返回低敏 forbidden/unavailable/redacted 状态。
//   - 财务/预算/ROI/成本等无一等事实来源的指标 MUST 判为 unsupported。
//   - AI 只参与 advisory 建议，不参与聚合数值计算。

// ─── 契约版本 ─────────────────────────────────────────────────────────────

export const BI_AGGREGATION_METRIC_VERSION = 'bi-aggregation-v1'

// ─── Scope ────────────────────────────────────────────────────────────────

export const BI_AGGREGATION_SCOPES = {
  ORGANIZATION: 'organization',
  PMO: 'pmo',
  PROJECT: 'project',
} as const

export type BiAggregationScope = (typeof BI_AGGREGATION_SCOPES)[keyof typeof BI_AGGREGATION_SCOPES]

export const BI_AGGREGATION_SCOPE_VALUES = Object.values(
  BI_AGGREGATION_SCOPES,
) as readonly BiAggregationScope[]

// ─── 指标键 ───────────────────────────────────────────────────────────────

/** 首批白名单指标键（9 类，见 design.md §D2 与 proposal 首批 registry contract key）。 */
export const BI_AGGREGATION_METRIC_KEYS = {
  /** BI 趋势进度 */
  BI_TREND_PROGRESS: 'bi_trend_progress',
  /** BI 趋势延期压力 */
  BI_TREND_DELAY: 'bi_trend_delay',
  /** BI 趋势风险压力 */
  BI_TREND_RISK: 'bi_trend_risk',
  /** BI 趋势资源压力 */
  BI_TREND_RESOURCE: 'bi_trend_resource',
  /** BI 趋势预测压力 */
  BI_TREND_FORECAST: 'bi_trend_forecast',
  /** BI 趋势 OKR 进展 */
  BI_TREND_OKR: 'bi_trend_okr',
  /** BI Dashboard 摘要 */
  BI_DASHBOARD_SUMMARY: 'bi_dashboard_summary',
  /** V2 报表数据源 */
  REPORT_V2_DATASOURCE: 'report_v2_datasource',
  /** 组织 Dashboard 摘要 */
  ORGANIZATION_DASHBOARD_SUMMARY: 'organization_dashboard_summary',
  /** PMO Dashboard 摘要 */
  PMO_DASHBOARD_SUMMARY: 'pmo_dashboard_summary',
  /** 资源摘要 */
  RESOURCE_SUMMARY: 'resource_summary',
  /** OKR 摘要 */
  OKR_SUMMARY: 'okr_summary',
  /** 风险摘要 */
  RISK_SUMMARY: 'risk_summary',
  /** 项目健康摘要 */
  PROJECT_HEALTH_SUMMARY: 'project_health_summary',
} as const

export type BiAggregationMetricKey =
  (typeof BI_AGGREGATION_METRIC_KEYS)[keyof typeof BI_AGGREGATION_METRIC_KEYS]

export const BI_AGGREGATION_METRIC_KEY_VALUES = Object.values(
  BI_AGGREGATION_METRIC_KEYS,
) as readonly BiAggregationMetricKey[]

/**
 * 已知但不支持的财务类指标键：识别后必须返回 unsupported/unavailable，
 * 绝不伪造财务值（V1/V3 红线：不做财务/预算）。
 */
export const BI_AGGREGATION_UNSUPPORTED_METRIC_KEYS = {
  BUDGET_COST: 'budget_cost',
  ROI: 'roi',
  CASH_FLOW: 'cash_flow',
  REVENUE: 'revenue',
  MARGIN: 'margin',
} as const

export type BiAggregationUnsupportedMetricKey =
  (typeof BI_AGGREGATION_UNSUPPORTED_METRIC_KEYS)[keyof typeof BI_AGGREGATION_UNSUPPORTED_METRIC_KEYS]

// ─── 维度键 ───────────────────────────────────────────────────────────────

export const BI_AGGREGATION_DIMENSION_KEYS = {
  PROJECT: 'project',
  PORTFOLIO_GROUP: 'portfolio_group',
  DEPARTMENT: 'department',
  ASSIGNEE: 'assignee',
  TIME_BUCKET: 'time_bucket',
  RISK_LEVEL: 'risk_level',
  RISK_CATEGORY: 'risk_category',
  RESOURCE_ROLE: 'resource_role',
  OKR_OBJECTIVE: 'okr_objective',
  PROJECT_STATUS: 'project_status',
  HEALTH_STATUS: 'health_status',
} as const

export type BiAggregationDimensionKey =
  (typeof BI_AGGREGATION_DIMENSION_KEYS)[keyof typeof BI_AGGREGATION_DIMENSION_KEYS]

export const BI_AGGREGATION_DIMENSION_KEY_VALUES = Object.values(
  BI_AGGREGATION_DIMENSION_KEYS,
) as readonly BiAggregationDimensionKey[]

// ─── 来源键 ───────────────────────────────────────────────────────────────

export const BI_AGGREGATION_SOURCE_KEYS = {
  BI_TREND_METRICS: 'bi_trend_metrics',
  BI_DASHBOARD_SUMMARY: 'bi_dashboard_summary',
  REPORT_V2_DATASOURCE: 'report_v2_datasource',
  ORGANIZATION_DASHBOARD: 'organization_dashboard',
  PMO_DASHBOARD: 'pmo_dashboard',
  RESOURCE_POOL: 'resource_pool',
  OKR_DASHBOARD: 'okr_dashboard',
  RISK_REGISTER: 'risk_register',
  PROJECT_HEALTH_DIAGNOSIS: 'project_health_diagnosis',
} as const

export type BiAggregationSourceKey =
  (typeof BI_AGGREGATION_SOURCE_KEYS)[keyof typeof BI_AGGREGATION_SOURCE_KEYS]

export const BI_AGGREGATION_SOURCE_KEY_VALUES = Object.values(
  BI_AGGREGATION_SOURCE_KEYS,
) as readonly BiAggregationSourceKey[]

// ─── 时间窗口 ─────────────────────────────────────────────────────────────

export const BI_AGGREGATION_WINDOWS = {
  LAST_7_DAYS: 'last_7_days',
  LAST_30_DAYS: 'last_30_days',
  LAST_90_DAYS: 'last_90_days',
  LAST_180_DAYS: 'last_180_days',
  LAST_365_DAYS: 'last_365_days',
  CURRENT_MONTH: 'current_month',
  CURRENT_QUARTER: 'current_quarter',
  CURRENT_YEAR: 'current_year',
} as const

export type BiAggregationWindow =
  (typeof BI_AGGREGATION_WINDOWS)[keyof typeof BI_AGGREGATION_WINDOWS]

export const BI_AGGREGATION_WINDOW_VALUES = Object.values(
  BI_AGGREGATION_WINDOWS,
) as readonly BiAggregationWindow[]

export const BI_AGGREGATION_WINDOW_MAX_DAYS = 730 // 2年上限

// ─── Grain ────────────────────────────────────────────────────────────────

export const BI_AGGREGATION_GRAINS = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly',
} as const

export type BiAggregationGrain = (typeof BI_AGGREGATION_GRAINS)[keyof typeof BI_AGGREGATION_GRAINS]

export const BI_AGGREGATION_GRAIN_VALUES = Object.values(
  BI_AGGREGATION_GRAINS,
) as readonly BiAggregationGrain[]

// ─── 筛选操作符 ───────────────────────────────────────────────────────────

export const BI_AGGREGATION_FILTER_OPERATORS = {
  EQ: 'eq',
  NEQ: 'neq',
  IN: 'in',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  BETWEEN: 'between',
} as const

export type BiAggregationFilterOperator =
  (typeof BI_AGGREGATION_FILTER_OPERATORS)[keyof typeof BI_AGGREGATION_FILTER_OPERATORS]

export const BI_AGGREGATION_FILTER_OPERATOR_VALUES = Object.values(
  BI_AGGREGATION_FILTER_OPERATORS,
) as readonly BiAggregationFilterOperator[]

// ─── Compare Mode ─────────────────────────────────────────────────────────

export const BI_AGGREGATION_COMPARE_MODES = {
  PREVIOUS_PERIOD: 'previous_period',
  SAME_PERIOD_LAST_YEAR: 'same_period_last_year',
  NONE: 'none',
} as const

export type BiAggregationCompareMode =
  (typeof BI_AGGREGATION_COMPARE_MODES)[keyof typeof BI_AGGREGATION_COMPARE_MODES]

export const BI_AGGREGATION_COMPARE_MODE_VALUES = Object.values(
  BI_AGGREGATION_COMPARE_MODES,
) as readonly BiAggregationCompareMode[]

// ─── Sort ─────────────────────────────────────────────────────────────────

export const BI_AGGREGATION_SORT_KEYS = {
  VALUE: 'value',
  LABEL: 'label',
  DATE: 'date',
  RANK: 'rank',
  COUNT: 'count',
  PERCENTAGE: 'percentage',
  DELTA: 'delta',
} as const

export type BiAggregationSortKey =
  (typeof BI_AGGREGATION_SORT_KEYS)[keyof typeof BI_AGGREGATION_SORT_KEYS]

export const BI_AGGREGATION_SORT_KEY_VALUES = Object.values(
  BI_AGGREGATION_SORT_KEYS,
) as readonly BiAggregationSortKey[]

export const BI_AGGREGATION_SORT_DIRS = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type BiAggregationSortDir =
  (typeof BI_AGGREGATION_SORT_DIRS)[keyof typeof BI_AGGREGATION_SORT_DIRS]

// ─── 查询上限 ─────────────────────────────────────────────────────────────

export const BI_AGGREGATION_MAX_METRIC_KEYS = 10
export const BI_AGGREGATION_MAX_DIMENSIONS = 6
export const BI_AGGREGATION_MAX_FILTERS = 20
export const BI_AGGREGATION_DEFAULT_PER_PAGE = 50
export const BI_AGGREGATION_MAX_PER_PAGE = 200

// ─── Source Freshness ──────────────────────────────────────────────────────

export const BI_AGGREGATION_FRESHNESS_STATES = {
  FRESH: 'fresh',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  DEGRADED: 'degraded',
  UNKNOWN: 'unknown',
} as const

export type BiAggregationFreshnessState =
  (typeof BI_AGGREGATION_FRESHNESS_STATES)[keyof typeof BI_AGGREGATION_FRESHNESS_STATES]

export const BI_AGGREGATION_FRESHNESS_STATE_VALUES = Object.values(
  BI_AGGREGATION_FRESHNESS_STATES,
) as readonly BiAggregationFreshnessState[]

// ─── Source Status ─────────────────────────────────────────────────────────

export const BI_AGGREGATION_SOURCE_STATUSES = {
  SUCCESS: 'success',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout',
  EMPTY: 'empty',
  REDACTED: 'redacted',
} as const

export type BiAggregationSourceStatus =
  (typeof BI_AGGREGATION_SOURCE_STATUSES)[keyof typeof BI_AGGREGATION_SOURCE_STATUSES]

// ─── Redaction ─────────────────────────────────────────────────────────────

export const BI_AGGREGATION_REDACTION_STATES = {
  NONE: 'none',
  PARTIAL: 'partial',
  FULL: 'full',
} as const

export type BiAggregationRedactionState =
  (typeof BI_AGGREGATION_REDACTION_STATES)[keyof typeof BI_AGGREGATION_REDACTION_STATES]

// ─── Warning / Error Codes ─────────────────────────────────────────────────

export const BI_AGGREGATION_WARNING_CODES = {
  STALE_SOURCE: 'STALE_SOURCE',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_FORBIDDEN: 'SOURCE_FORBIDDEN',
  SOURCE_TIMEOUT: 'SOURCE_TIMEOUT',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  UNSUPPORTED_METRIC: 'UNSUPPORTED_METRIC',
  INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
  MISSING_BUCKET: 'MISSING_BUCKET',
  PARTIAL_REDACTION: 'PARTIAL_REDACTION',
  TRUNCATED_RESULT: 'TRUNCATED_RESULT',
} as const

export type BiAggregationWarningCode =
  (typeof BI_AGGREGATION_WARNING_CODES)[keyof typeof BI_AGGREGATION_WARNING_CODES]

export const BI_AGGREGATION_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
} as const

export type BiAggregationErrorCode =
  (typeof BI_AGGREGATION_ERROR_CODES)[keyof typeof BI_AGGREGATION_ERROR_CODES]

// ─── Warning / Error 结构 ──────────────────────────────────────────────────

export interface BiAggregationWarning {
  code: BiAggregationWarningCode
  level: 'info' | 'warning' | 'blocking'
  message: string
  sourceKey?: BiAggregationSourceKey
  metricKey?: BiAggregationMetricKey
  dimensionKey?: BiAggregationDimensionKey
}

export interface BiAggregationError {
  code: BiAggregationErrorCode
  message: string
  details?: unknown
}

// ─── Filter ────────────────────────────────────────────────────────────────

export interface BiAggregationFilter {
  dimension: BiAggregationDimensionKey
  operator: BiAggregationFilterOperator
  value: string | number | boolean
  values?: (string | number)[]
  valueEnd?: number // for 'between'
}

// ─── Sort ─────────────────────────────────────────────────────────────────

export interface BiAggregationSort {
  key: BiAggregationSortKey
  dir: BiAggregationSortDir
}

// ─── 来源引用 ─────────────────────────────────────────────────────────────

export interface BiAggregationSourceRef {
  sourceKey: BiAggregationSourceKey
  status: BiAggregationSourceStatus
  generatedAt: string // ISO 8601
  sourceHash: string
  metricVersion: string
  freshness: BiAggregationFreshness
  warnings: BiAggregationWarning[]
}

export interface BiAggregationFreshness {
  state: BiAggregationFreshnessState
  generatedAt: string // ISO 8601
  ttlSeconds: number
  expired: boolean
}

// ─── Provenance ────────────────────────────────────────────────────────────

export interface BiAggregationProvenance {
  queryHash: string
  calculatedAt: string // ISO 8601
  metricVersion: string
  sourceRefs: BiAggregationSourceRef[]
  redaction: BiAggregationRedaction
}

export interface BiAggregationRedaction {
  state: BiAggregationRedactionState
  redactedDimensions: string[]
  redactedSources: string[]
}

// ─── Evidence ──────────────────────────────────────────────────────────────

export interface BiAggregationEvidenceRef {
  sourceKey: BiAggregationSourceKey
  metricKey: BiAggregationMetricKey
  dimensionKey?: BiAggregationDimensionKey
  freshness: BiAggregationFreshness
  authorized: boolean
  targetType: string
  refId: string
}

// ─── Cache ─────────────────────────────────────────────────────────────────

export interface BiAggregationCachePolicy {
  enabled: boolean
  ttlSeconds: number
  degraded: boolean
}

export const BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS = 300

// ─── 查询 ─────────────────────────────────────────────────────────────────

export interface BiAggregationQuery {
  scope: BiAggregationScope
  metricKeys: BiAggregationMetricKey[]
  dimensions?: BiAggregationDimensionKey[]
  filters?: BiAggregationFilter[]
  window?: BiAggregationWindow
  grain?: BiAggregationGrain
  compareWith?: BiAggregationCompareMode
  sort?: BiAggregationSort
  page?: number
  perPage?: number
  includeSources?: boolean
  includeEvidence?: boolean
}

export interface BiAggregationQueryShape {
  scope: string
  metricKeys: string[] // sorted
  dimensionKeys: string[] // sorted
  filterKeys: string[] // sorted
  window: string
  grain: string
  compareWith: string
}

// ─── 结果 ─────────────────────────────────────────────────────────────────

export interface BiAggregationResultRow {
  dimensionValues: Record<string, string>
  metricValues: Record<BiAggregationMetricKey, number | null>
  redactedMetrics?: BiAggregationMetricKey[]
}

export interface BiAggregationSeriesPoint {
  bucket: string // ISO 8601 date or period label
  metricKey: BiAggregationMetricKey
  value: number | null
  dimensionValue?: Record<string, string>
}

export interface BiAggregationDimensionBucket {
  dimensionKey: BiAggregationDimensionKey
  value: string
  label?: string
  count: number
}

export interface BiAggregationComparison {
  mode: BiAggregationCompareMode
  rows: BiAggregationResultRow[]
  series: BiAggregationSeriesPoint[]
}

export interface BiAggregationResult {
  rows: BiAggregationResultRow[]
  series: BiAggregationSeriesPoint[]
  dimensionBuckets: BiAggregationDimensionBucket[]
  comparison?: BiAggregationComparison
  provenance: BiAggregationProvenance
  warnings: BiAggregationWarning[]
  evidence?: BiAggregationEvidenceRef[]
  cache: BiAggregationCachePolicy
}

// ─── API Envelope ──────────────────────────────────────────────────────────

export interface BiAggregationResponseMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  queryHash: string
  calculatedAt: string
  freshnessSummary: Record<BiAggregationSourceKey, BiAggregationFreshnessState>
  warningCount: number
  redactionState: BiAggregationRedactionState
}

export interface BiAggregationResponse {
  data: BiAggregationResult
  meta: BiAggregationResponseMeta
}

// ─── 错误信封 ─────────────────────────────────────────────────────────────

export interface BiAggregationErrorResponse {
  error: BiAggregationError
}

// ─── Registry 契约 ────────────────────────────────────────────────────────

export interface BiAggregationMetricDefinition {
  key: BiAggregationMetricKey
  displayKey: string // 中文显示 metadata key
  scope: BiAggregationScope[]
  sourceKey: BiAggregationSourceKey
  allowedGrains: BiAggregationGrain[]
  allowedWindows: BiAggregationWindow[]
  allowedFilters: BiAggregationDimensionKey[]
  aggregationStrategy: 'sum' | 'avg' | 'count' | 'latest' | 'weighted_avg'
  permissionTags: string[]
  freshnessThresholdSeconds: number
  unsupportedFallback: 'unavailable' | 'omit'
}

export interface BiAggregationDimensionDefinition {
  key: BiAggregationDimensionKey
  displayKey: string
  scope: BiAggregationScope[]
  drillDownTargetPolicy: 'none' | 'project' | 'task' | 'risk' | 'okr' | 'resource'
  redactionStrategy: 'hide_full' | 'hide_count' | 'allow'
}

export interface BiAggregationSourceDefinition {
  key: BiAggregationSourceKey
  displayKey: string
  scope: BiAggregationScope[]
  adapterRef: string
  permissionTags: string[]
  fallbackBehavior: 'unavailable' | 'omit' | 'degraded'
  freshnessPolicy: 'on_demand' | 'cache_with_ttl' | 'snapshot'
  freshnessTtlSeconds: number
  warningCodes: BiAggregationWarningCode[]
}

// ─── 纯函数 ───────────────────────────────────────────────────────────────

/** 判断 metricKey 是否为财务类不支持指标。 */
export function isUnsupportedBiAggregationMetricKey(key: string): boolean {
  return Object.values(BI_AGGREGATION_UNSUPPORTED_METRIC_KEYS).includes(
    key as BiAggregationUnsupportedMetricKey,
  )
}

/** 判断是否为有效 metric key。 */
export function isBiAggregationMetricKey(key: string): key is BiAggregationMetricKey {
  return BI_AGGREGATION_METRIC_KEY_VALUES.includes(key as BiAggregationMetricKey)
}

/** 判断是否为有效 dimension key。 */
export function isBiAggregationDimensionKey(key: string): key is BiAggregationDimensionKey {
  return BI_AGGREGATION_DIMENSION_KEY_VALUES.includes(key as BiAggregationDimensionKey)
}

/** 判断是否为有效 source key。 */
export function isBiAggregationSourceKey(key: string): key is BiAggregationSourceKey {
  return BI_AGGREGATION_SOURCE_KEY_VALUES.includes(key as BiAggregationSourceKey)
}

/** 判断是否超出 metric 数量上限。 */
export function isBiAggregationMetricCountWithinLimit(keys: string[]): boolean {
  return keys.length <= BI_AGGREGATION_MAX_METRIC_KEYS
}

/** 判断是否超出 dimension 数量上限。 */
export function isBiAggregationDimensionCountWithinLimit(keys: string[]): boolean {
  return keys.length <= BI_AGGREGATION_MAX_DIMENSIONS
}

/** 判断是否超出 filter 数量上限。 */
export function isBiAggregationFilterCountWithinLimit(filters: unknown[]): boolean {
  return filters.length <= BI_AGGREGATION_MAX_FILTERS
}

/** 判断是否超出 perPage 上限。 */
export function isBiAggregationPerPageWithinLimit(perPage: number): boolean {
  return perPage >= 1 && perPage <= BI_AGGREGATION_MAX_PER_PAGE
}

/** 规范化并排序 metric keys（用于 hash 稳定性）。 */
export function normalizeBiAggregationMetricKeys(
  keys: BiAggregationMetricKey[],
): BiAggregationMetricKey[] {
  return [...new Set(keys)].sort()
}

/** 规范化并排序 dimension keys。 */
export function normalizeBiAggregationDimensionKeys(
  keys: BiAggregationDimensionKey[],
): BiAggregationDimensionKey[] {
  return [...new Set(keys)].sort()
}

/** 构建查询形状（用于 hash 和 cache key）。 */
export function buildBiAggregationQueryShape(query: BiAggregationQuery): BiAggregationQueryShape {
  return {
    scope: query.scope,
    metricKeys: [...(query.metricKeys ?? [])].sort(),
    dimensionKeys: [...(query.dimensions ?? [])].sort(),
    filterKeys: [...(query.filters ?? []).map((f) => `${f.dimension}:${f.operator}`)].sort(),
    window: query.window ?? BI_AGGREGATION_WINDOWS.LAST_30_DAYS,
    grain: query.grain ?? BI_AGGREGATION_GRAINS.WEEKLY,
    compareWith: query.compareWith ?? BI_AGGREGATION_COMPARE_MODES.NONE,
  }
}

/** 确定性 JSON 序列化（键排序，用于 hash）。 */
function deterministicSerialize(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj)
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicSerialize).join(',') + ']'
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map(
      (k) => `${JSON.stringify(k)}:${deterministicSerialize((obj as Record<string, unknown>)[k])}`,
    )
  return '{' + sorted.join(',') + '}'
}

/** 稳定查询 hash（顺序无关）。 */
export function computeBiAggregationQueryHash(query: BiAggregationQuery): string {
  const shape = buildBiAggregationQueryShape(query)
  const serialized = deterministicSerialize(shape)
  // 使用简单 djb2-like hash（零运行时依赖）
  let hash = 5381
  for (let i = 0; i < serialized.length; i++) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 构建缓存 key（包含权限范围）。 */
export function buildBiAggregationCacheKey(
  organizationId: number,
  actorFingerprint: string,
  queryHash: string,
  permissionScope: string,
  registryVersion: string,
): string {
  const parts = [
    `org:${organizationId}`,
    `actor:${actorFingerprint}`,
    `q:${queryHash}`,
    `perm:${permissionScope}`,
    `reg:${registryVersion}`,
  ]
  return `bi:agg:${deterministicSerialize(parts)}`
}

/** 合并多个来源的 freshness 状态（最差优先）。 */
export function mergeBiAggregationFreshness(
  states: BiAggregationFreshnessState[],
): BiAggregationFreshnessState {
  if (states.length === 0) return BI_AGGREGATION_FRESHNESS_STATES.UNKNOWN
  if (states.includes(BI_AGGREGATION_FRESHNESS_STATES.UNAVAILABLE)) {
    return BI_AGGREGATION_FRESHNESS_STATES.DEGRADED
  }
  if (states.includes(BI_AGGREGATION_FRESHNESS_STATES.STALE)) {
    return BI_AGGREGATION_FRESHNESS_STATES.STALE
  }
  if (states.every((s) => s === BI_AGGREGATION_FRESHNESS_STATES.FRESH)) {
    return BI_AGGREGATION_FRESHNESS_STATES.FRESH
  }
  if (states.includes(BI_AGGREGATION_FRESHNESS_STATES.UNKNOWN)) {
    return BI_AGGREGATION_FRESHNESS_STATES.UNKNOWN
  }
  return BI_AGGREGATION_FRESHNESS_STATES.DEGRADED
}

/** 合并多条 warning（去重相同 code+source）。 */
export function mergeBiAggregationWarnings(all: BiAggregationWarning[]): BiAggregationWarning[] {
  const seen = new Set<string>()
  const merged: BiAggregationWarning[] = []
  for (const w of all) {
    const key = `${w.code}:${w.sourceKey ?? ''}:${w.metricKey ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(w)
    }
  }
  return merged
}

/** 构建 structured warning */
export function buildBiAggregationWarning(
  code: BiAggregationWarningCode,
  level: 'info' | 'warning' | 'blocking',
  message: string,
  sourceKey?: BiAggregationSourceKey,
  metricKey?: BiAggregationMetricKey,
  dimensionKey?: BiAggregationDimensionKey,
): BiAggregationWarning {
  return { code, level, message, sourceKey, metricKey, dimensionKey }
}

/** 计算 redaction 汇总状态。 */
export function summarizeBiAggregationRedaction(
  redactedDimensions: string[],
  redactedSources: string[],
  totalDimensions: number,
  totalSources: number,
): BiAggregationRedactionState {
  if (redactedDimensions.length === totalDimensions || redactedSources.length === totalSources) {
    return BI_AGGREGATION_REDACTION_STATES.FULL
  }
  if (redactedDimensions.length > 0 || redactedSources.length > 0) {
    return BI_AGGREGATION_REDACTION_STATES.PARTIAL
  }
  return BI_AGGREGATION_REDACTION_STATES.NONE
}

/** 创建低敏 evidence ref。 */
export function makeBiAggregationEvidenceRef(
  sourceKey: BiAggregationSourceKey,
  metricKey: BiAggregationMetricKey,
  freshness: BiAggregationFreshness,
  targetType: string,
  refId: string,
  authorized: boolean,
  dimensionKey?: BiAggregationDimensionKey,
): BiAggregationEvidenceRef {
  return {
    sourceKey,
    metricKey,
    dimensionKey,
    freshness,
    authorized,
    targetType,
    refId,
  }
}

/**
 * 从 evidence refs 数组去除不安全字段。
 * 本函数不返回完整证据正文、prompt、模型输出、密钥、token 或隐藏实体名称。
 */
export function redactBiAggregationEvidence(
  refs: BiAggregationEvidenceRef[],
): BiAggregationEvidenceRef[] {
  return refs.map((r) => ({
    ...r,
    // authorized=false 时额外脱敏 refId
    refId: r.authorized ? r.refId : '',
  }))
}

/** 判断响应是否被 redacted。 */
export function isBiAggregationRedacted(state: BiAggregationRedactionState): boolean {
  return state !== BI_AGGREGATION_REDACTION_STATES.NONE
}

/** 构建 mock 来源引用。 */
export function makeBiAggregationSourceRef(
  sourceKey: BiAggregationSourceKey,
  status: BiAggregationSourceStatus,
  overrides?: Partial<Omit<BiAggregationSourceRef, 'sourceKey' | 'status'>>,
): BiAggregationSourceRef {
  return {
    sourceKey,
    status,
    generatedAt: overrides?.generatedAt ?? new Date().toISOString(),
    sourceHash: overrides?.sourceHash ?? '',
    metricVersion: overrides?.metricVersion ?? BI_AGGREGATION_METRIC_VERSION,
    freshness: overrides?.freshness ?? {
      state: BI_AGGREGATION_FRESHNESS_STATES.UNKNOWN,
      generatedAt: new Date().toISOString(),
      ttlSeconds: BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS,
      expired: false,
    },
    warnings: overrides?.warnings ?? [],
  }
}

/** 验证查询参数合法性（bounds validation）。 */
export function validateBiAggregationQueryBounds(
  query: BiAggregationQuery,
): BiAggregationValidationResult {
  const issues: string[] = []

  if (!query.metricKeys || query.metricKeys.length === 0) {
    issues.push('metricKeys 不能为空')
  }
  if (query.metricKeys && !isBiAggregationMetricCountWithinLimit(query.metricKeys)) {
    issues.push(`metricKeys 数量不能超过 ${BI_AGGREGATION_MAX_METRIC_KEYS}`)
  }
  if (query.dimensions && !isBiAggregationDimensionCountWithinLimit(query.dimensions)) {
    issues.push(`dimensions 数量不能超过 ${BI_AGGREGATION_MAX_DIMENSIONS}`)
  }
  if (query.filters && !isBiAggregationFilterCountWithinLimit(query.filters)) {
    issues.push(`filters 数量不能超过 ${BI_AGGREGATION_MAX_FILTERS}`)
  }
  if (query.perPage !== undefined && !isBiAggregationPerPageWithinLimit(query.perPage)) {
    issues.push(`perPage 必须在 1-${BI_AGGREGATION_MAX_PER_PAGE} 之间`)
  }

  for (const mk of query.metricKeys) {
    if (isUnsupportedBiAggregationMetricKey(mk)) {
      issues.push(`不支持的财务指标: ${mk}`)
    }
  }

  for (const f of query.filters ?? []) {
    if (f.operator === BI_AGGREGATION_FILTER_OPERATORS.BETWEEN && f.valueEnd === undefined) {
      issues.push(`filter ${f.dimension} 使用 between 操作符需要 valueEnd`)
    }
  }

  return { valid: issues.length === 0, issues }
}

export interface BiAggregationValidationResult {
  valid: boolean
  issues: string[]
}

// ─── Fixture Builders ─────────────────────────────────────────────────────

/**
 * `metricValues` / `freshnessSummary` 的契约是完整 Record（每个 key 都要有值），
 * 故 fixture 先铺满默认值，再覆盖需要断言的那几个 key。
 */
function fullMetricValues(
  overrides: Partial<Record<BiAggregationMetricKey, number | null>> = {},
): Record<BiAggregationMetricKey, number | null> {
  const base = {} as Record<BiAggregationMetricKey, number | null>
  for (const key of Object.values(BI_AGGREGATION_METRIC_KEYS)) {
    base[key as BiAggregationMetricKey] = null
  }
  return { ...base, ...overrides }
}

function fullFreshnessSummary(
  overrides: Partial<Record<BiAggregationSourceKey, BiAggregationFreshnessState>> = {},
): Record<BiAggregationSourceKey, BiAggregationFreshnessState> {
  const base = {} as Record<BiAggregationSourceKey, BiAggregationFreshnessState>
  for (const key of Object.values(BI_AGGREGATION_SOURCE_KEYS)) {
    base[key as BiAggregationSourceKey] = BI_AGGREGATION_FRESHNESS_STATES.FRESH
  }
  return { ...base, ...overrides }
}

/** 创建授权聚合 fixture */
export function makeAuthorizedAggregationFixture(
  overrides?: Partial<BiAggregationResult>,
): BiAggregationResult {
  return {
    rows: [
      {
        dimensionValues: { project: '项目A' },
        metricValues: fullMetricValues({ bi_trend_progress: 75, bi_dashboard_summary: 80 }),
      },
    ],
    series: [
      { bucket: '2026-07-01', metricKey: 'bi_trend_progress' as BiAggregationMetricKey, value: 72 },
      { bucket: '2026-07-08', metricKey: 'bi_trend_progress' as BiAggregationMetricKey, value: 75 },
    ],
    dimensionBuckets: [
      {
        dimensionKey: 'project' as BiAggregationDimensionKey,
        value: 'project_a',
        label: '项目A',
        count: 1,
      },
    ],
    provenance: {
      queryHash: 'abc123',
      calculatedAt: new Date().toISOString(),
      metricVersion: BI_AGGREGATION_METRIC_VERSION,
      sourceRefs: [],
      redaction: {
        state: BI_AGGREGATION_REDACTION_STATES.NONE,
        redactedDimensions: [],
        redactedSources: [],
      },
    },
    warnings: [],
    cache: {
      enabled: false,
      ttlSeconds: BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS,
      degraded: false,
    },
    ...overrides,
  }
}

/** 创建部分 redacted fixture */
export function makeRedactedAggregationFixture(): BiAggregationResult {
  return makeAuthorizedAggregationFixture({
    provenance: {
      queryHash: 'redacted_01',
      calculatedAt: new Date().toISOString(),
      metricVersion: BI_AGGREGATION_METRIC_VERSION,
      sourceRefs: [
        makeBiAggregationSourceRef(
          'okr_dashboard' as BiAggregationSourceKey,
          'forbidden' as BiAggregationSourceStatus,
        ),
      ],
      redaction: {
        state: BI_AGGREGATION_REDACTION_STATES.PARTIAL,
        redactedDimensions: ['okr_objective'],
        redactedSources: ['okr_dashboard'],
      },
    },
    warnings: [
      buildBiAggregationWarning(
        'SOURCE_FORBIDDEN' as BiAggregationWarningCode,
        'warning',
        'OKR Dashboard 来源权限不足',
        'okr_dashboard' as BiAggregationSourceKey,
      ),
    ],
    rows: [
      {
        dimensionValues: { project: '项目A' },
        metricValues: fullMetricValues({ bi_trend_progress: 75, bi_dashboard_summary: 80 }),
        redactedMetrics: ['okr_summary' as BiAggregationMetricKey],
      },
    ],
  })
}

/** 创建 stale source fixture */
export function makeStaleAggregationFixture(): BiAggregationResult {
  const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 2天前
  return makeAuthorizedAggregationFixture({
    provenance: {
      queryHash: 'stale_01',
      calculatedAt: new Date().toISOString(),
      metricVersion: BI_AGGREGATION_METRIC_VERSION,
      sourceRefs: [
        {
          sourceKey: 'pmo_dashboard' as BiAggregationSourceKey,
          status: 'success' as BiAggregationSourceStatus,
          generatedAt: staleDate,
          sourceHash: 'abc',
          metricVersion: BI_AGGREGATION_METRIC_VERSION,
          freshness: {
            state: BI_AGGREGATION_FRESHNESS_STATES.STALE,
            generatedAt: staleDate,
            ttlSeconds: 300,
            expired: true,
          },
          warnings: [],
        },
      ],
      redaction: {
        state: BI_AGGREGATION_REDACTION_STATES.NONE,
        redactedDimensions: [],
        redactedSources: [],
      },
    },
    warnings: [
      buildBiAggregationWarning(
        'STALE_SOURCE' as BiAggregationWarningCode,
        'warning',
        'PMO Dashboard 来源已过期（超过 24h）',
        'pmo_dashboard' as BiAggregationSourceKey,
      ),
    ],
  })
}

/** 创建缓存降级 fixture */
export function makeCacheDegradedAggregationFixture(): BiAggregationResult {
  return makeAuthorizedAggregationFixture({
    cache: { enabled: true, ttlSeconds: BI_AGGREGATION_CACHE_DEFAULT_TTL_SECONDS, degraded: true },
    warnings: [
      buildBiAggregationWarning(
        'CACHE_DEGRADED' as BiAggregationWarningCode,
        'info',
        'BI 聚合缓存不可用，返回直接计算结果',
      ),
    ],
  })
}

/** 创建 unsupported metric fixture */
export function makeUnsupportedAggregationFixture(): BiAggregationResult {
  return makeAuthorizedAggregationFixture({
    rows: [],
    series: [],
    dimensionBuckets: [],
    warnings: [
      buildBiAggregationWarning(
        'UNSUPPORTED_METRIC' as BiAggregationWarningCode,
        'blocking',
        '不支持的财务指标: budget_cost',
      ),
    ],
  })
}

/** 创建 source unavailable fixture */
export function makeSourceUnavailableAggregationFixture(): BiAggregationResult {
  return makeAuthorizedAggregationFixture({
    provenance: {
      queryHash: 'unavail_01',
      calculatedAt: new Date().toISOString(),
      metricVersion: BI_AGGREGATION_METRIC_VERSION,
      sourceRefs: [
        makeBiAggregationSourceRef(
          'risk_register' as BiAggregationSourceKey,
          'unavailable' as BiAggregationSourceStatus,
        ),
      ],
      redaction: {
        state: BI_AGGREGATION_REDACTION_STATES.NONE,
        redactedDimensions: [],
        redactedSources: [],
      },
    },
    warnings: [
      buildBiAggregationWarning(
        'SOURCE_UNAVAILABLE' as BiAggregationWarningCode,
        'warning',
        '风险登记册来源未实现',
        'risk_register' as BiAggregationSourceKey,
      ),
    ],
  })
}

/**
 * 创建大组织 fixture（1000+ 项目等效输入）。
 * 行数和系列数模拟大组织规模。
 */
export function makeLargeOrganizationAggregationFixture(
  projectCount: number = 1000,
): BiAggregationResult {
  const rows: BiAggregationResultRow[] = []
  const series: BiAggregationSeriesPoint[] = []
  const buckets: BiAggregationDimensionBucket[] = []

  for (let i = 0; i < Math.min(projectCount, 1000); i++) {
    rows.push({
      dimensionValues: { project: `项目_${i + 1}` },
      metricValues: fullMetricValues({
        bi_trend_progress: Math.round(Math.random() * 100),
        bi_dashboard_summary: Math.round(Math.random() * 100),
      }),
    })
    series.push({
      bucket: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
      metricKey: 'bi_trend_progress' as BiAggregationMetricKey,
      value: Math.round(Math.random() * 100),
      dimensionValue: { project: `项目_${i + 1}` },
    })
    buckets.push({
      dimensionKey: 'project' as BiAggregationDimensionKey,
      value: `project_${i + 1}`,
      label: `项目_${i + 1}`,
      count: 1,
    })
  }

  return makeAuthorizedAggregationFixture({ rows, series, dimensionBuckets: buckets })
}

/** 创建 API response meta fixture */
export function makeBiAggregationResponseMeta(
  overrides?: Partial<BiAggregationResponseMeta>,
): BiAggregationResponseMeta {
  return {
    total: overrides?.total ?? 100,
    page: overrides?.page ?? 1,
    perPage: overrides?.perPage ?? BI_AGGREGATION_DEFAULT_PER_PAGE,
    totalPages: overrides?.totalPages ?? 2,
    queryHash: overrides?.queryHash ?? 'fixture_hash',
    calculatedAt: overrides?.calculatedAt ?? new Date().toISOString(),
    freshnessSummary: overrides?.freshnessSummary ?? fullFreshnessSummary(),
    warningCount: overrides?.warningCount ?? 0,
    redactionState: overrides?.redactionState ?? BI_AGGREGATION_REDACTION_STATES.NONE,
  }
}
