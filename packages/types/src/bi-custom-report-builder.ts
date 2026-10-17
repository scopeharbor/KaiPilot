// @aiproj/types —— BI 自定义报表构建器共享契约（前后端共享）。
// v3-bi-custom-report-builder §1.3：dataSourceKey、fieldKey、filter/group/sort、
// visualization、layout、definition、preview、warning/error、source/evidence 和 audit 契约。
//
// 红线：
//   - 只读派生：预览和执行不携带写入语义；正式生成/导出走 reporting-system-upgrade。
//   - 零依赖：本文件不得 import AdonisJS、React、数据库客户端、AI SDK 或第三方运行时。
//   - 定义 MUST NOT 包含任意 SQL、脚本、公式、外部 URL、prompt、模型输出、secret。
//   - 权限受限字段只返回低敏 forbidden/unavailable/redacted 状态。
//   - 财务/预算/ROI/成本等无一等事实来源的指标 MUST 判为 unsupported。

// ─── 契约版本 ─────────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_CONTRACT_VERSION = 'bi-custom-report-v1'

// ─── 数据源注册表键 ───────────────────────────────────────────────────────

/** 自定义报表数据源键白名单。 */
export const BI_CUSTOM_REPORT_DATA_SOURCE_KEYS = {
  TASK_SUMMARY: 'task_summary',
  SCHEDULE_SUMMARY: 'schedule_summary',
  RISK_SUMMARY: 'risk_summary',
  RESOURCE_SUMMARY: 'resource_summary',
  DASHBOARD_METRICS: 'dashboard_metrics',
  TIMELINE_ACTIVITY: 'timeline_activity',
  COMPILER_SUMMARY: 'compiler_summary',
  CHANGE_IMPACT: 'change_impact',
  BI_TREND_SERIES: 'bi_trend_series',
  BI_RISK_HEATMAP: 'bi_risk_heatmap',
  RESOURCE_FORECAST: 'resource_forecast',
  RESOURCE_GAP: 'resource_gap',
  RESOURCE_CONTENTION: 'resource_contention',
  OKR_PROGRESS: 'okr_progress',
  OKR_ALIGNMENT: 'okr_alignment',
  PMO_PORTFOLIO: 'pmo_portfolio',
  PMO_PRIORITY: 'pmo_priority',
} as const

export type BiCustomReportDataSourceKey =
  (typeof BI_CUSTOM_REPORT_DATA_SOURCE_KEYS)[keyof typeof BI_CUSTOM_REPORT_DATA_SOURCE_KEYS]

export const BI_CUSTOM_REPORT_DATA_SOURCE_KEY_VALUES = Object.values(
  BI_CUSTOM_REPORT_DATA_SOURCE_KEYS,
) as readonly BiCustomReportDataSourceKey[]

// ─── 字段键 ────────────────────────────────────────────────────────────────

/** 自定义报表字段键白名单。 */
export const BI_CUSTOM_REPORT_FIELD_KEYS = {
  // 通用
  PROJECT_NAME: 'project_name',
  PROJECT_STATUS: 'project_status',
  PROJECT_PROGRESS: 'project_progress',
  PORTFOLIO_NAME: 'portfolio_name',

  // 任务
  TASK_COUNT: 'task_count',
  TASK_COMPLETED: 'task_completed',
  TASK_OVERDUE: 'task_overdue',
  TASK_NEAR_DUE: 'task_near_due',

  // 里程碑
  MILESTONE_NAME: 'milestone_name',
  MILESTONE_STATUS: 'milestone_status',
  MILESTONE_DATE: 'milestone_date',

  // 风险
  RISK_COUNT: 'risk_count',
  RISK_LEVEL: 'risk_level',
  RISK_STATUS: 'risk_status',

  // 资源
  RESOURCE_NAME: 'resource_name',
  RESOURCE_LOAD: 'resource_load',
  RESOURCE_UTILIZATION: 'resource_utilization',
  RESOURCE_DEMAND_HOURS: 'resource_demand_hours',
  RESOURCE_GAP_HOURS: 'resource_gap_hours',

  // OKR
  OKR_OBJECTIVE_TITLE: 'okr_objective_title',
  OKR_PROGRESS_PCT: 'okr_progress_pct',
  OKR_KR_COUNT: 'okr_kr_count',

  // PMO
  PMO_SCORE: 'pmo_score',
  PMO_TRAFFIC_LIGHT: 'pmo_traffic_light',
  PMO_INVESTMENT: 'pmo_investment',

  // 趋势
  TREND_DIRECTION: 'trend_direction',
  TREND_VALUE: 'trend_value',

  // 热力图
  HEATMAP_CELL_VALUE: 'heatmap_cell_value',
  HEATMAP_DIMENSION: 'heatmap_dimension',

  // 时间
  DATE: 'date',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
} as const

export type BiCustomReportFieldKey =
  (typeof BI_CUSTOM_REPORT_FIELD_KEYS)[keyof typeof BI_CUSTOM_REPORT_FIELD_KEYS]

export const BI_CUSTOM_REPORT_FIELD_KEY_VALUES = Object.values(
  BI_CUSTOM_REPORT_FIELD_KEYS,
) as readonly BiCustomReportFieldKey[]

// ─── 筛选器 ────────────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_FILTER_OPERATORS = {
  EQ: 'eq',
  NEQ: 'neq',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  IN: 'in',
  NOT_IN: 'not_in',
  BETWEEN: 'between',
  CONTAINS: 'contains',
  STARTS_WITH: 'starts_with',
} as const

export type BiCustomReportFilterOperator =
  (typeof BI_CUSTOM_REPORT_FILTER_OPERATORS)[keyof typeof BI_CUSTOM_REPORT_FILTER_OPERATORS]

export const BI_CUSTOM_REPORT_FILTER_OPERATOR_VALUES = Object.values(
  BI_CUSTOM_REPORT_FILTER_OPERATORS,
) as readonly BiCustomReportFilterOperator[]

export interface BiCustomReportFilter {
  fieldKey: BiCustomReportFieldKey
  operator: BiCustomReportFilterOperator
  value: unknown
  label?: string
}

// ─── 分组 / 排序 ───────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_AGGREGATORS = {
  COUNT: 'count',
  SUM: 'sum',
  AVG: 'avg',
  MIN: 'min',
  MAX: 'max',
  COUNT_DISTINCT: 'count_distinct',
  PERCENTAGE: 'percentage',
  MEDIAN: 'median',
} as const

export type BiCustomReportAggregator =
  (typeof BI_CUSTOM_REPORT_AGGREGATORS)[keyof typeof BI_CUSTOM_REPORT_AGGREGATORS]

export const BI_CUSTOM_REPORT_AGGREGATOR_VALUES = Object.values(
  BI_CUSTOM_REPORT_AGGREGATORS,
) as readonly BiCustomReportAggregator[]

export const BI_CUSTOM_REPORT_SORT_DIRECTIONS = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type BiCustomReportSortDirection =
  (typeof BI_CUSTOM_REPORT_SORT_DIRECTIONS)[keyof typeof BI_CUSTOM_REPORT_SORT_DIRECTIONS]

export interface BiCustomReportGroup {
  fieldKey: BiCustomReportFieldKey
  label?: string
}

export interface BiCustomReportSort {
  fieldKey: BiCustomReportFieldKey
  direction: BiCustomReportSortDirection
  label?: string
}

// ─── 可视化 ────────────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_VISUALIZATION_TYPES = {
  TABLE: 'table',
  METRIC_CARD: 'metric_card',
  LINE: 'line',
  BAR: 'bar',
  STACKED_BAR: 'stacked_bar',
  HEATMAP: 'heatmap',
} as const

export type BiCustomReportVisualizationType =
  (typeof BI_CUSTOM_REPORT_VISUALIZATION_TYPES)[keyof typeof BI_CUSTOM_REPORT_VISUALIZATION_TYPES]

export const BI_CUSTOM_REPORT_VISUALIZATION_TYPE_VALUES = Object.values(
  BI_CUSTOM_REPORT_VISUALIZATION_TYPES,
) as readonly BiCustomReportVisualizationType[]

export interface BiCustomReportVisualization {
  type: BiCustomReportVisualizationType
  title?: string
  xField?: BiCustomReportFieldKey
  yField?: BiCustomReportFieldKey
  seriesField?: BiCustomReportFieldKey
  colorPalette?: string
  height?: number
  width?: number
}

// ─── 布局 ──────────────────────────────────────────────────────────────────

export interface BiCustomReportLayout {
  gridColumns?: number
  gridRows?: number
  sections?: BiCustomReportLayoutSection[]
}

export interface BiCustomReportLayoutSection {
  key: string
  title?: string
  visualizationIndexes: number[]
  col?: number
  row?: number
  colSpan?: number
  rowSpan?: number
}

// ─── Scope / Visibility ────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_SCOPES = {
  ORGANIZATION: 'organization',
  PORTFOLIO: 'portfolio',
  PROJECT: 'project',
} as const

export type BiCustomReportScope =
  (typeof BI_CUSTOM_REPORT_SCOPES)[keyof typeof BI_CUSTOM_REPORT_SCOPES]

export const BI_CUSTOM_REPORT_SCOPE_VALUES = Object.values(
  BI_CUSTOM_REPORT_SCOPES,
) as readonly BiCustomReportScope[]

export const BI_CUSTOM_REPORT_VISIBILITY = {
  PERSONAL: 'personal',
  SHARED: 'shared',
} as const

export type BiCustomReportVisibility =
  (typeof BI_CUSTOM_REPORT_VISIBILITY)[keyof typeof BI_CUSTOM_REPORT_VISIBILITY]

export const BI_CUSTOM_REPORT_VISIBILITY_VALUES = Object.values(
  BI_CUSTOM_REPORT_VISIBILITY,
) as readonly BiCustomReportVisibility[]

// ─── 数据源注册表条目 ──────────────────────────────────────────────────────

export interface BiCustomReportDataSourceDef {
  sourceKey: BiCustomReportDataSourceKey
  name: string
  description: string
  fields: BiCustomReportFieldDef[]
  dimensions: BiCustomReportFieldKey[]
  supportedFilters: BiCustomReportFilterOperator[]
  supportedAggregators: BiCustomReportAggregator[]
  compatibleVisualizations: BiCustomReportVisualizationType[]
  permissionTags: string[]
  freshnessStrategy: 'live' | 'cached' | 'snapshot'
  freshnessTtlMinutes?: number
  fallbackBehavior: 'blocking' | 'stale_warning' | 'empty'
}

export interface BiCustomReportFieldDef {
  fieldKey: BiCustomReportFieldKey
  name: string
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum'
  enumValues?: readonly string[]
  aggregatable: boolean
  filterable: boolean
  sortable: boolean
  permissionTag?: string
  drillDownTarget?: string
}

// ─── Definition ────────────────────────────────────────────────────────────

export interface BiCustomReportDefinition {
  definitionId: string
  organizationId: number
  projectId?: number | null
  portfolioId?: number | null
  scope: BiCustomReportScope
  visibility: BiCustomReportVisibility
  ownerActorId: number
  version: number
  definitionHash: string
  title: string
  description?: string
  dataSources: BiCustomReportDataSourceRef[]
  fields: BiCustomReportFieldKey[]
  filters: BiCustomReportFilter[]
  groups: BiCustomReportGroup[]
  sorts: BiCustomReportSort[]
  visualizations: BiCustomReportVisualization[]
  layout?: BiCustomReportLayout
  isDefault: boolean
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
  createdBy: number
  updatedBy: number
  warnings?: BiCustomReportWarning[]
}

export interface BiCustomReportDataSourceRef {
  sourceKey: BiCustomReportDataSourceKey
  alias?: string
  label?: string
}

// ─── Preview ────────────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_PREVIEW_STATUS = {
  READY: 'ready',
  BLOCKED: 'blocked',
  PARTIAL: 'partial',
} as const

export type BiCustomReportPreviewStatus =
  (typeof BI_CUSTOM_REPORT_PREVIEW_STATUS)[keyof typeof BI_CUSTOM_REPORT_PREVIEW_STATUS]

export interface BiCustomReportPreviewResult {
  status: BiCustomReportPreviewStatus
  definitionHash: string
  rows: BiCustomReportPreviewRow[]
  series: BiCustomReportPreviewSeries[]
  cards: BiCustomReportPreviewCard[]
  warnings: BiCustomReportWarning[]
  freshness: BiCustomReportFreshness
  sourceHashes: Record<string, string>
  blocked: boolean
  blockedReasons: string[]
  evidenceRefs: BiCustomReportEvidenceRef[]
  generatedAt: string
}

export interface BiCustomReportPreviewRow {
  cells: Record<string, unknown>
}

export interface BiCustomReportPreviewSeries {
  key: string
  label?: string
  values: number[]
  labels?: string[]
}

export interface BiCustomReportPreviewCard {
  key: string
  title?: string
  value: number | string
  format?: 'number' | 'percentage' | 'currency' | 'duration'
  trend?: 'up' | 'down' | 'flat'
}

// ─── Warning / Error ────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_WARNING_CODES = {
  // blocking
  REQUIRED_DATASOURCE_UNAVAILABLE: 'BI_CR_REQUIRED_DATASOURCE_UNAVAILABLE',
  REQUIRED_FIELD_FORBIDDEN: 'BI_CR_REQUIRED_FIELD_FORBIDDEN',
  COMPLEXITY_EXCEEDED: 'BI_CR_COMPLEXITY_EXCEEDED',
  TIMEOUT: 'BI_CR_TIMEOUT',
  PERMISSION_DENIED_SOURCE: 'BI_CR_PERMISSION_DENIED_SOURCE',

  // non-blocking
  OPTIONAL_DATASOURCE_UNAVAILABLE: 'BI_CR_OPTIONAL_DATASOURCE_UNAVAILABLE',
  FIELD_FORBIDDEN: 'BI_CR_FIELD_FORBIDDEN',
  STALE_DATA: 'BI_CR_STALE_DATA',
  FIELD_INCOMPATIBLE: 'BI_CR_FIELD_INCOMPATIBLE',
  VISUALIZATION_INCOMPATIBLE: 'BI_CR_VISUALIZATION_INCOMPATIBLE',
  EMPTY_RESULT: 'BI_CR_EMPTY_RESULT',
  PARTIAL_REDACTION: 'BI_CR_PARTIAL_REDACTION',
  UNSUPPORTED_METRIC: 'BI_CR_UNSUPPORTED_METRIC',
  AI_UNAVAILABLE: 'BI_CR_AI_UNAVAILABLE',
} as const

export type BiCustomReportWarningCode =
  (typeof BI_CUSTOM_REPORT_WARNING_CODES)[keyof typeof BI_CUSTOM_REPORT_WARNING_CODES]

export const BI_CUSTOM_REPORT_WARNING_CODE_VALUES = Object.values(
  BI_CUSTOM_REPORT_WARNING_CODES,
) as readonly BiCustomReportWarningCode[]

export const BI_CUSTOM_REPORT_WARNING_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  BLOCKING: 'blocking',
} as const

export type BiCustomReportWarningLevel =
  (typeof BI_CUSTOM_REPORT_WARNING_LEVELS)[keyof typeof BI_CUSTOM_REPORT_WARNING_LEVELS]

export interface BiCustomReportWarning {
  code: BiCustomReportWarningCode
  level: BiCustomReportWarningLevel
  message: string
  sourceKey?: string
  fieldKey?: string
  detail?: Record<string, unknown>
}

// ─── Freshness ─────────────────────────────────────────────────────────────

export interface BiCustomReportFreshness {
  generatedAt: string
  status: 'fresh' | 'stale' | 'unknown'
  ttlMinutes?: number
  oldestSourceAt?: string
}

// ─── Evidence ──────────────────────────────────────────────────────────────

export interface BiCustomReportEvidenceRef {
  sourceKey: BiCustomReportDataSourceKey
  sourceHash: string
  entityType: string
  entityId: number
  summary: string
  authorized: boolean
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_AUDIT_ACTIONS = {
  CREATE: 'bi_custom_report.create',
  UPDATE: 'bi_custom_report.update',
  COPY: 'bi_custom_report.copy',
  SHARE: 'bi_custom_report.share',
  SET_DEFAULT: 'bi_custom_report.set_default',
  ARCHIVE: 'bi_custom_report.archive',
  RESTORE: 'bi_custom_report.restore',
  GENERATE_FROM_DEFINITION: 'bi_custom_report.generate_from_definition',
} as const

export type BiCustomReportAuditAction =
  (typeof BI_CUSTOM_REPORT_AUDIT_ACTIONS)[keyof typeof BI_CUSTOM_REPORT_AUDIT_ACTIONS]

export interface BiCustomReportAuditPayload {
  actor: number
  organizationId: number
  definitionId: string
  action: BiCustomReportAuditAction
  versionTransition?: { from: number; to: number }
  scope?: BiCustomReportScope
  visibility?: BiCustomReportVisibility
  changedDataSourceKeys?: BiCustomReportDataSourceKey[]
  changedVisualizationKeys?: BiCustomReportVisualizationType[]
  resultStatus: 'success' | 'failure'
  timestamp: string
  correlationId?: string
}

// ─── API Envelope ──────────────────────────────────────────────────────────

export interface BiCustomReportApiEnvelope<T> {
  data: T
  meta?: BiCustomReportApiMeta
}

export interface BiCustomReportApiMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface BiCustomReportApiError {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ─── 版本历史 ──────────────────────────────────────────────────────────────

export interface BiCustomReportVersionEntry {
  version: number
  definitionHash: string
  title: string
  updatedAt: string
  updatedBy: number
  changeSummary?: string
}

// ─── 复杂度限制 ────────────────────────────────────────────────────────────

export const BI_CUSTOM_REPORT_LIMITS = {
  MAX_DATA_SOURCES: 5,
  MAX_FIELDS: 30,
  MAX_FILTERS: 15,
  MAX_GROUPS: 5,
  MAX_SORTS: 8,
  MAX_VISUALIZATIONS: 6,
  MAX_TITLE_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_PAYLOAD_BYTES: 65536,
  MAX_LAYOUT_GRID_COLUMNS: 12,
  MAX_LAYOUT_GRID_ROWS: 100,
  PREVIEW_TIMEOUT_MS: 15000,
  PREVIEW_MAX_ROWS: 1000,
} as const

// ─── 确定性纯函数 ──────────────────────────────────────────────────────────

/**
 * 稳定 definitionHash 计算（deterministic JSON canonicalization）。
 * 相同 definition payload 必须产生相同 hash。
 */
export function computeBiCustomReportDefinitionHash(def: {
  dataSources: Array<{ sourceKey: string }>
  fields: string[]
  filters: BiCustomReportFilter[]
  groups: BiCustomReportGroup[]
  sorts: BiCustomReportSort[]
  visualizations: BiCustomReportVisualization[]
}): string {
  const canonical = JSON.stringify(
    {
      ds: def.dataSources.map((d) => d.sourceKey).sort(),
      f: [...def.fields].sort(),
      fl: def.filters.map((f) => `${f.fieldKey}:${f.operator}:${JSON.stringify(f.value)}`).sort(),
      g: def.groups.map((g) => g.fieldKey).sort(),
      s: def.sorts.map((s) => `${s.fieldKey}:${s.direction}`).sort(),
      v: def.visualizations.map((v) => v.type).sort(),
    },
    (_, v) => (v === undefined ? null : v),
  )
  let hash = 0
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i)
    hash = (hash << 5) - hash + ch
    hash |= 0
  }
  return `bh_${Math.abs(hash).toString(36)}`
}

/** 检查 warning code 是否为 blocking 级别。 */
export function isBlockingWarningCode(code: BiCustomReportWarningCode): boolean {
  const blockingCodes: BiCustomReportWarningCode[] = [
    BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE,
    BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_FIELD_FORBIDDEN,
    BI_CUSTOM_REPORT_WARNING_CODES.COMPLEXITY_EXCEEDED,
    BI_CUSTOM_REPORT_WARNING_CODES.TIMEOUT,
    BI_CUSTOM_REPORT_WARNING_CODES.PERMISSION_DENIED_SOURCE,
  ]
  return blockingCodes.includes(code)
}

/** 检查 preview 结果是否可保存/可生成。 */
export function isBiCustomReportPreviewSaveable(result: BiCustomReportPreviewResult): boolean {
  return !result.blocked
}

/** 低敏 evidence ref redaction。 */
export function redactBiCustomReportEvidence(
  ref: BiCustomReportEvidenceRef,
): BiCustomReportEvidenceRef {
  if (ref.authorized) return ref
  return {
    sourceKey: ref.sourceKey,
    sourceHash: '<redacted>',
    entityType: ref.entityType,
    entityId: 0,
    summary: '[无权访问]',
    authorized: false,
  }
}

/** 构建低敏 warning。 */
export function buildBiCustomReportWarning(
  code: BiCustomReportWarningCode,
  level: BiCustomReportWarningLevel,
  message: string,
  opts?: { sourceKey?: string; fieldKey?: string; detail?: Record<string, unknown> },
): BiCustomReportWarning {
  return {
    code,
    level,
    message,
    sourceKey: opts?.sourceKey,
    fieldKey: opts?.fieldKey,
    detail: opts?.detail,
  }
}
