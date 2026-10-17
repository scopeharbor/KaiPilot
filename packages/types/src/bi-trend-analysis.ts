// @aiproj/types —— BI 趋势分析共享契约（前后端共享）。
// v3-bi-trend-analysis §2：指标键、来源类型、粒度、窗口、维度、warning、
// 脱敏状态、freshness、evidence、query/response、异常点、外推、advisory insight，
// 以及零运行时依赖的确定性趋势纯函数。
//
// 红线：
//   - 只读派生：契约不携带任何写入语义；forecast/insight 仅 advisory。
//   - 零依赖：本文件不得 import AdonisJS、React、数据库客户端、AI SDK 或第三方运行时。
//   - 权限受限维度只返回低敏 forbidden/unavailable/redacted 状态，不暴露隐藏计数、
//     名称、成员姓名、风险名称、OKR 私密标题、证据原文或不安全下钻链接。
//   - 财务/预算/ROI/成本等无一等事实来源的指标 MUST 判为 unsupported，绝不伪造数值。
//   - 趋势事实由确定性规则支撑；AI 不参与数值计算。

// ─── 计算版本 ─────────────────────────────────────────────────────────────

/** BI 趋势计算与契约版本；破坏性变更必须升版本并触发契约测试更新。 */
export const BI_TREND_METRIC_VERSION = 'bi-trend-v1'

// ─── 指标键 ───────────────────────────────────────────────────────────────

/** 首批白名单指标（六类，见 design.md Open Questions 裁决）。 */
export const BI_TREND_METRIC_KEYS = {
  /** 组织项目进度（完成度百分比，0-100） */
  PROJECT_PROGRESS: 'project_progress',
  /** 延期压力（逾期/临近截止任务占比，0-100） */
  SCHEDULE_DELAY_PRESSURE: 'schedule_delay_pressure',
  /** 风险压力（开放风险加权分） */
  RISK_PRESSURE: 'risk_pressure',
  /** 资源压力（缺口/争用强度，0-100） */
  RESOURCE_PRESSURE: 'resource_pressure',
  /** 预测压力（预测需求缺口小时数） */
  FORECAST_DEMAND_PRESSURE: 'forecast_demand_pressure',
  /** OKR 进展（KR 平均进度，0-100） */
  OKR_PROGRESS: 'okr_progress',
} as const

export type BiTrendMetricKey = (typeof BI_TREND_METRIC_KEYS)[keyof typeof BI_TREND_METRIC_KEYS]

export const BI_TREND_METRIC_KEY_VALUES = Object.values(
  BI_TREND_METRIC_KEYS,
) as readonly BiTrendMetricKey[]

/**
 * 已知但不支持的财务类指标键：识别后必须返回 unsupported/unavailable，
 * 绝不伪造财务值（V1/V3 红线：不做财务/预算）。
 */
export const BI_TREND_UNSUPPORTED_METRIC_KEYS = {
  BUDGET_COST: 'budget_cost',
  ROI: 'roi',
  CASH_FLOW: 'cash_flow',
  BUDGET_VARIANCE: 'budget_variance',
} as const

export type BiTrendUnsupportedMetricKey =
  (typeof BI_TREND_UNSUPPORTED_METRIC_KEYS)[keyof typeof BI_TREND_UNSUPPORTED_METRIC_KEYS]

export const BI_TREND_UNSUPPORTED_METRIC_KEY_VALUES = Object.values(
  BI_TREND_UNSUPPORTED_METRIC_KEYS,
) as readonly BiTrendUnsupportedMetricKey[]

// ─── 来源类型 ─────────────────────────────────────────────────────────────

export const BI_TREND_SOURCE_KINDS = {
  ORGANIZATION_DASHBOARD: 'organization_dashboard',
  PMO_PORTFOLIO_DASHBOARD: 'pmo_portfolio_dashboard',
  RESOURCE_DEMAND_FORECASTING: 'resource_demand_forecasting',
  RESOURCE_GAP_ANALYSIS: 'resource_gap_analysis',
  RESOURCE_CONTENTION_DETECTION: 'resource_contention_detection',
  OKR_HIERARCHY: 'okr_hierarchy',
  REPORT_SNAPSHOT: 'report_snapshot',
  RISK_REGISTER: 'risk_register',
  HEALTH_SNAPSHOT: 'health_snapshot',
} as const

export type BiTrendSourceKind = (typeof BI_TREND_SOURCE_KINDS)[keyof typeof BI_TREND_SOURCE_KINDS]

export const BI_TREND_SOURCE_KIND_VALUES = Object.values(
  BI_TREND_SOURCE_KINDS,
) as readonly BiTrendSourceKind[]

// ─── 时间粒度 ─────────────────────────────────────────────────────────────

export const BI_TREND_GRAINS = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
} as const

export type BiTrendGrain = (typeof BI_TREND_GRAINS)[keyof typeof BI_TREND_GRAINS]

export const BI_TREND_GRAIN_VALUES = Object.values(BI_TREND_GRAINS) as readonly BiTrendGrain[]

// ─── 时间窗口 ─────────────────────────────────────────────────────────────

export const BI_TREND_WINDOWS = {
  LAST_7_DAYS: 'last_7_days',
  LAST_30_DAYS: 'last_30_days',
  LAST_90_DAYS: 'last_90_days',
  LAST_12_WEEKS: 'last_12_weeks',
  LAST_6_MONTHS: 'last_6_months',
  LAST_12_MONTHS: 'last_12_months',
} as const

export type BiTrendWindow = (typeof BI_TREND_WINDOWS)[keyof typeof BI_TREND_WINDOWS]

export const BI_TREND_WINDOW_VALUES = Object.values(BI_TREND_WINDOWS) as readonly BiTrendWindow[]

/** 窗口 → 天数（用于边界校验与桶枚举）。 */
export const BI_TREND_WINDOW_DAYS: Record<BiTrendWindow, number> = {
  last_7_days: 7,
  last_30_days: 30,
  last_90_days: 90,
  last_12_weeks: 84,
  last_6_months: 183,
  last_12_months: 366,
}

/** 绝对上限：任何窗口不得超过 366 天。 */
export const BI_TREND_MAX_WINDOW_DAYS = 366

// ─── 维度键 ───────────────────────────────────────────────────────────────

export const BI_TREND_DIMENSION_KEYS = {
  PROJECT: 'project',
  DEPARTMENT: 'department',
  ROLE: 'role',
  SKILL: 'skill',
  PORTFOLIO_GROUP: 'portfolio_group',
  OKR_LEVEL: 'okr_level',
  RISK_LEVEL: 'risk_level',
} as const

export type BiTrendDimensionKey =
  (typeof BI_TREND_DIMENSION_KEYS)[keyof typeof BI_TREND_DIMENSION_KEYS]

export const BI_TREND_DIMENSION_KEY_VALUES = Object.values(
  BI_TREND_DIMENSION_KEYS,
) as readonly BiTrendDimensionKey[]

// ─── 对比模式 ─────────────────────────────────────────────────────────────

export const BI_TREND_COMPARE_MODES = {
  NONE: 'none',
  PREVIOUS_PERIOD: 'previous_period',
} as const

export type BiTrendCompareMode =
  (typeof BI_TREND_COMPARE_MODES)[keyof typeof BI_TREND_COMPARE_MODES]

export const BI_TREND_COMPARE_MODE_VALUES = Object.values(
  BI_TREND_COMPARE_MODES,
) as readonly BiTrendCompareMode[]

// ─── 方向 ─────────────────────────────────────────────────────────────────

export const BI_TREND_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
  FLAT: 'flat',
  UNKNOWN: 'unknown',
} as const

export type BiTrendDirection = (typeof BI_TREND_DIRECTIONS)[keyof typeof BI_TREND_DIRECTIONS]

// ─── 新鲜度状态 ───────────────────────────────────────────────────────────

export const BI_TREND_FRESHNESS_STATES = {
  FRESH: 'fresh',
  STALE: 'stale',
  UNKNOWN: 'unknown',
} as const

export type BiTrendFreshnessState =
  (typeof BI_TREND_FRESHNESS_STATES)[keyof typeof BI_TREND_FRESHNESS_STATES]

// ─── 脱敏状态 ─────────────────────────────────────────────────────────────

export const BI_TREND_REDACTION_STATES = {
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  REDACTED: 'redacted',
} as const

export type BiTrendRedactionState =
  (typeof BI_TREND_REDACTION_STATES)[keyof typeof BI_TREND_REDACTION_STATES]

export const BI_TREND_REDACTION_STATE_VALUES = Object.values(
  BI_TREND_REDACTION_STATES,
) as readonly BiTrendRedactionState[]

// ─── 告警码 ───────────────────────────────────────────────────────────────

export const BI_TREND_WARNING_CODES = {
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
} as const

export type BiTrendWarningCode =
  (typeof BI_TREND_WARNING_CODES)[keyof typeof BI_TREND_WARNING_CODES]

export const BI_TREND_WARNING_CODE_VALUES = Object.values(
  BI_TREND_WARNING_CODES,
) as readonly BiTrendWarningCode[]

// ─── 排序键 ───────────────────────────────────────────────────────────────

export const BI_TREND_SORT_KEYS = {
  METRIC_KEY: 'metricKey',
  DIRECTION: 'direction',
  LATEST_VALUE: 'latestValue',
  ANOMALY_COUNT: 'anomalyCount',
  FRESHNESS: 'freshness',
} as const

export type BiTrendSortKey = (typeof BI_TREND_SORT_KEYS)[keyof typeof BI_TREND_SORT_KEYS]

export const BI_TREND_SORT_KEY_VALUES = Object.values(
  BI_TREND_SORT_KEYS,
) as readonly BiTrendSortKey[]

// ─── 中文标签映射（UI 显示用） ──────────────────────────────────────────────

/** 趋势方向中文标签。 */
export const BI_TREND_DIRECTION_LABELS: Record<string, string> = {
  up: '上升',
  down: '下降',
  flat: '持平',
  unknown: '未知',
}

/** 时间粒度中文标签。 */
export const BI_TREND_GRAIN_LABELS: Record<string, string> = {
  day: '日',
  week: '周',
  month: '月',
}

/** 时间窗口中文标签。 */
export const BI_TREND_WINDOW_LABELS: Record<string, string> = {
  last_30_days: '最近 30 天',
  last_90_days: '最近 90 天',
  last_12_weeks: '最近 12 周',
  last_6_months: '最近 6 个月',
  last_12_months: '最近 12 个月',
}

// ─── 下钻目标类型 ─────────────────────────────────────────────────────────

export const BI_TREND_DRILLDOWN_TARGET_KINDS = {
  PROJECT: 'project',
  PMO_PORTFOLIO: 'pmo_portfolio',
  OKR: 'okr',
  RESOURCE: 'resource',
  RISK: 'risk',
  REPORT: 'report',
  DASHBOARD: 'dashboard',
} as const

export type BiTrendDrilldownTargetKind =
  (typeof BI_TREND_DRILLDOWN_TARGET_KINDS)[keyof typeof BI_TREND_DRILLDOWN_TARGET_KINDS]

export const BI_TREND_DRILLDOWN_TARGET_KIND_VALUES = Object.values(
  BI_TREND_DRILLDOWN_TARGET_KINDS,
) as readonly BiTrendDrilldownTargetKind[]

// ─── Insight 严重度 ───────────────────────────────────────────────────────

export const BI_TREND_INSIGHT_SEVERITIES = {
  INFO: 'info',
  ATTENTION: 'attention',
  CRITICAL: 'critical',
} as const

export type BiTrendInsightSeverity =
  (typeof BI_TREND_INSIGHT_SEVERITIES)[keyof typeof BI_TREND_INSIGHT_SEVERITIES]

// ─── 有界限制 ─────────────────────────────────────────────────────────────

/** 单次查询最多指标数。 */
export const BI_TREND_MAX_METRICS = 8
/** 单次查询最多维度切片数。 */
export const BI_TREND_MAX_DIMENSIONS = 3
/** 每页条数上限。 */
export const BI_TREND_MAX_PER_PAGE = 100
/** 默认每页条数。 */
/** 默认时间窗口。 */
export const BI_TREND_DEFAULT_WINDOW: BiTrendWindow = 'last_12_weeks'

/** 默认时间粒度。 */
export const BI_TREND_DEFAULT_GRAIN: BiTrendGrain = 'week'

export const BI_TREND_DEFAULT_PER_PAGE = 20
/** 方向判定所需最少非缺失桶数。 */
export const BI_TREND_MIN_BUCKETS_FOR_DIRECTION = 3
/** 外推所需最少非缺失桶数。 */
export const BI_TREND_MIN_BUCKETS_FOR_FORECAST = 6
/** 移动平均窗口（桶数）。 */
export const BI_TREND_MOVING_AVERAGE_WINDOW = 3
/** 异常点 z-score 阈值。 */
export const BI_TREND_ANOMALY_Z_THRESHOLD = 2.5
/** 短期外推的桶数上限。 */
export const BI_TREND_FORECAST_HORIZON = 3
/** 方向判定 flat 阈值（相对变化绝对值 ≤ 该值判 flat）。 */
export const BI_TREND_DIRECTION_FLAT_THRESHOLD = 0.05
/** 默认来源新鲜度阈值（秒）；超过则标记 STALE_SOURCE。 */
export const BI_TREND_DEFAULT_FRESHNESS_THRESHOLD_SECONDS = 24 * 3600

// ─── DTO: 查询 ────────────────────────────────────────────────────────────

/** 低敏筛选形态：只允许白名单字段，值数量受限。 */
export interface BiTrendFilters {
  projectIds?: string[]
  departments?: string[]
  roles?: string[]
  skills?: string[]
  portfolioGroups?: string[]
  riskLevels?: string[]
}

export interface BiTrendQuery {
  metricKeys: BiTrendMetricKey[]
  window: BiTrendWindow
  grain: BiTrendGrain
  dimensions?: BiTrendDimensionKey[]
  filters?: BiTrendFilters
  compareWith?: BiTrendCompareMode
  includeAnomalies?: boolean
  includeForecast?: boolean
  sort?: BiTrendSortKey
  sortDir?: 'asc' | 'desc'
  page?: number
  perPage?: number
  freshnessThresholdSeconds?: number
}

// ─── DTO: 趋势点 / 序列 ───────────────────────────────────────────────────

export interface BiTrendPoint {
  /** 桶起始（ISO 8601 date，UTC） */
  bucketStart: string
  /** 桶结束（ISO 8601 date，UTC，含） */
  bucketEnd: string
  /** 指标值；missing 时为 null */
  value: number | null
  /** 缺失桶标记（来源无数据，不得伪造为 0） */
  missing: boolean
  /** 该桶样本数（低敏计数） */
  sampleCount: number
}

export interface BiTrendComparison {
  /** 上期同窗口平均值；历史不足时为 null */
  previousAverage: number | null
  /** 本期平均值 */
  currentAverage: number
  /** 绝对变化量 */
  delta: number
  /** 相对变化率；上期为 0/null 时为 null */
  deltaRatio: number | null
}

export interface BiTrendAnomaly {
  bucketStart: string
  value: number
  /** 期望水平（均值） */
  expected: number
  /** 偏差量（value - expected） */
  deviation: number
  /** z-score */
  zScore: number
  direction: 'above' | 'below'
  /** 触发阈值 */
  threshold: number
  evidenceRefs: BiTrendEvidenceRef[]
}

export interface BiTrendForecastPoint {
  bucketStart: string
  bucketEnd: string
  value: number
}

export interface BiTrendForecast {
  method: 'linear_extrapolation'
  points: BiTrendForecastPoint[]
  /** 历史不足等原因被抑制时为 true，points 为空 */
  suppressed: boolean
  suppressionReason?: BiTrendWarningCode
}

// ─── DTO: 来源 / freshness / evidence ─────────────────────────────────────

export interface BiTrendSourceRef {
  sourceKind: BiTrendSourceKind
  metricVersion: string
  /** 来源最近刷新时间（ISO 8601 timestamp）；未知为 null */
  lastRefreshedAt: string | null
  state: BiTrendFreshnessState
}

export interface BiTrendFreshness {
  state: BiTrendFreshnessState
  /** 0-1：可见来源覆盖率 */
  sourceCoverage: number
  /** 低敏 freshness 哈希（供审计/比对，不含原始数据） */
  freshnessHash: string
  sources: BiTrendSourceRef[]
}

/** 低敏证据引用：不得携带证据原文、prompt、模型输出或成员姓名。 */
export interface BiTrendEvidenceRef {
  kind: BiTrendSourceKind
  /** 低敏标签（如指标名/桶标识），不得为证据原文 */
  label: string
  targetKind?: BiTrendDrilldownTargetKind
  /** 目标标识；受限时省略并由 redaction 标注 */
  targetId?: string
  redaction?: BiTrendRedactionState
}

// ─── DTO: warning / insight / 下钻 ────────────────────────────────────────

export interface BiTrendWarning {
  code: BiTrendWarningCode
  /** 低敏说明；不得包含隐藏名称或计数 */
  message: string
  metricKey?: BiTrendMetricKey
  dimension?: BiTrendDimensionKey
}

/** 安全下钻目标：仅前端导航用途，后端在目标端点重新授权。 */
export interface BiTrendDrilldownTarget {
  kind: BiTrendDrilldownTargetKind
  /** 前端路由路径（由后端白名单生成或前端 builder 生成） */
  path: string
  /** 低敏标签 */
  label: string
}

export interface BiTrendInsight {
  kind: 'anomaly_summary' | 'direction_summary' | 'forecast_summary' | 'possible_cause'
  severity: BiTrendInsightSeverity
  title: string
  description: string
  /** 恒为 true：任何 insight 都不可自动执行 */
  advisoryOnly: true
  drilldownTarget?: BiTrendDrilldownTarget
  warnings: BiTrendWarningCode[]
}

// ─── DTO: 响应 ────────────────────────────────────────────────────────────

export interface BiTrendSeries {
  metricKey: BiTrendMetricKey
  metricVersion: string
  grain: BiTrendGrain
  window: BiTrendWindow
  points: BiTrendPoint[]
  /** 移动平均（与 points 等长；不足窗口处为 null） */
  movingAverage: (number | null)[]
  comparison?: BiTrendComparison
  direction: BiTrendDirection
  anomalies: BiTrendAnomaly[]
  forecast?: BiTrendForecast
  freshness: BiTrendFreshness
  warnings: BiTrendWarning[]
  redaction?: BiTrendRedactionState
  evidenceRefs: BiTrendEvidenceRef[]
  insights: BiTrendInsight[]
  /** 非缺失桶样本总数 */
  sampleCount: number
}

export interface BiTrendsResponseMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  /** 组织 ID */
  organizationId?: number
  /** 响应计算时间（ISO 8601 timestamp） */
  calculatedAt?: string
  /** 指标版本 */
  metricVersion?: string
  /** 低敏查询形状回显 */
  queryShape?: BiTrendQueryShape
  /** 来源新鲜度哈希 */
  freshnessHash?: string
}

export interface BiTrendsResponse {
  data: BiTrendSeries[]
  meta: BiTrendsResponseMeta
  warnings?: BiTrendWarning[]
  /** 查询形状回显（低敏），供前端展示与审计对照 */
  queryShape: BiTrendQueryShape
  /** 响应计算时间（ISO 8601 timestamp） */
  calculatedAt: string
}

/** 低敏查询形状：只记录键与计数，不记录具体 ID 值。 */
export interface BiTrendQueryShape {
  metricKeys: BiTrendMetricKey[]
  window: BiTrendWindow
  grain: BiTrendGrain
  dimensionCount: number
  filterCounts: {
    projects: number
    departments: number
    roles: number
    skills: number
    portfolioGroups: number
    riskLevels: number
  }
  compareWith: BiTrendCompareMode
  includeAnomalies: boolean
  includeForecast: boolean
  page: number
  perPage: number
}

// ─── 守护 helpers（白名单/上限） ───────────────────────────────────────────

export function isSupportedBiTrendMetricKey(value: string): value is BiTrendMetricKey {
  return (BI_TREND_METRIC_KEY_VALUES as readonly string[]).includes(value)
}

/** 财务等已知但无一等事实来源的指标：必须显式 unsupported，不得伪造。 */
export function isUnsupportedFinancialMetricKey(
  value: string,
): value is BiTrendUnsupportedMetricKey {
  return (BI_TREND_UNSUPPORTED_METRIC_KEY_VALUES as readonly string[]).includes(value)
}

export function isSupportedBiTrendGrain(value: string): value is BiTrendGrain {
  return (BI_TREND_GRAIN_VALUES as readonly string[]).includes(value)
}

export function isSupportedBiTrendWindow(value: string): value is BiTrendWindow {
  return (BI_TREND_WINDOW_VALUES as readonly string[]).includes(value)
}

export function isSupportedBiTrendDimension(value: string): value is BiTrendDimensionKey {
  return (BI_TREND_DIMENSION_KEY_VALUES as readonly string[]).includes(value)
}

export function isSupportedBiTrendCompareMode(value: string): value is BiTrendCompareMode {
  return (BI_TREND_COMPARE_MODE_VALUES as readonly string[]).includes(value)
}

export function isSupportedBiTrendSortKey(value: string): value is BiTrendSortKey {
  return (BI_TREND_SORT_KEY_VALUES as readonly string[]).includes(value)
}

/** 窗口天数是否在有界范围内。 */
export function isBiTrendWindowWithinBounds(window: BiTrendWindow): boolean {
  const days = BI_TREND_WINDOW_DAYS[window]
  return Number.isFinite(days) && days > 0 && days <= BI_TREND_MAX_WINDOW_DAYS
}

export function isBiTrendMetricCountWithinLimit(count: number): boolean {
  return count >= 1 && count <= BI_TREND_MAX_METRICS
}

export function isBiTrendDimensionCountWithinLimit(count: number): boolean {
  return count >= 0 && count <= BI_TREND_MAX_DIMENSIONS
}

/** 历史是否足够支撑方向判定。 */
export function isBiTrendDirectionEligible(nonMissingBucketCount: number): boolean {
  return nonMissingBucketCount >= BI_TREND_MIN_BUCKETS_FOR_DIRECTION
}

/** 历史是否足够支撑短期外推。 */
export function isBiTrendForecastEligible(nonMissingBucketCount: number): boolean {
  return nonMissingBucketCount >= BI_TREND_MIN_BUCKETS_FOR_FORECAST
}

// ─── warning / redaction helpers ──────────────────────────────────────────

export function buildBiTrendWarning(
  code: BiTrendWarningCode,
  message: string,
  extra?: { metricKey?: BiTrendMetricKey; dimension?: BiTrendDimensionKey },
): BiTrendWarning {
  return { code, message, ...extra }
}

/** 受限维度的低敏 evidence：隐藏 targetId，只保留 redaction 状态。 */
export function redactBiTrendEvidence(ref: BiTrendEvidenceRef): BiTrendEvidenceRef {
  return {
    kind: ref.kind,
    label: ref.label,
    targetKind: ref.targetKind,
    redaction: BI_TREND_REDACTION_STATES.REDACTED,
  }
}

export function isBiTrendRedacted(ref: BiTrendEvidenceRef): boolean {
  return ref.redaction !== undefined
}

// ─── 查询形状序列化 ────────────────────────────────────────────────────────

export function buildBiTrendQueryShape(query: BiTrendQuery): BiTrendQueryShape {
  return {
    metricKeys: [...query.metricKeys],
    window: query.window,
    grain: query.grain,
    dimensionCount: query.dimensions?.length ?? 0,
    filterCounts: {
      projects: query.filters?.projectIds?.length ?? 0,
      departments: query.filters?.departments?.length ?? 0,
      roles: query.filters?.roles?.length ?? 0,
      skills: query.filters?.skills?.length ?? 0,
      portfolioGroups: query.filters?.portfolioGroups?.length ?? 0,
      riskLevels: query.filters?.riskLevels?.length ?? 0,
    },
    compareWith: query.compareWith ?? BI_TREND_COMPARE_MODES.NONE,
    includeAnomalies: query.includeAnomalies ?? false,
    includeForecast: query.includeForecast ?? false,
    page: query.page ?? 1,
    perPage: query.perPage ?? BI_TREND_DEFAULT_PER_PAGE,
  }
}

/** 序列化为 URL query 参数（扁平、低敏；数组逗号连接）。 */
export function serializeBiTrendQuery(query: BiTrendQuery): Record<string, string> {
  const out: Record<string, string> = {
    metricKeys: query.metricKeys.join(','),
    window: query.window,
    grain: query.grain,
  }
  if (query.dimensions?.length) out.dimensions = query.dimensions.join(',')
  if (query.filters?.projectIds?.length) out.projectIds = query.filters.projectIds.join(',')
  if (query.filters?.departments?.length) out.departments = query.filters.departments.join(',')
  if (query.filters?.roles?.length) out.roles = query.filters.roles.join(',')
  if (query.filters?.skills?.length) out.skills = query.filters.skills.join(',')
  if (query.filters?.portfolioGroups?.length)
    out.portfolioGroups = query.filters.portfolioGroups.join(',')
  if (query.filters?.riskLevels?.length) out.riskLevels = query.filters.riskLevels.join(',')
  if (query.compareWith) out.compareWith = query.compareWith
  if (query.includeAnomalies !== undefined) out.includeAnomalies = String(query.includeAnomalies)
  if (query.includeForecast !== undefined) out.includeForecast = String(query.includeForecast)
  if (query.sort) out.sort = query.sort
  if (query.sortDir) out.sortDir = query.sortDir
  if (query.page !== undefined) out.page = String(query.page)
  if (query.perPage !== undefined) out.perPage = String(query.perPage)
  return out
}

// ─── 确定性趋势纯函数 ──────────────────────────────────────────────────────
//
// 所有函数零副作用、零 Date.now()：当前时间一律由 referenceDate 参数注入，
// 保证前后端与测试得到逐字节一致的结果。

const MS_PER_DAY = 86400 * 1000

function toUtcDay(dateIso: string): number {
  const t = Date.parse(dateIso.length === 10 ? `${dateIso}T00:00:00.000Z` : dateIso)
  return Math.floor(t / MS_PER_DAY)
}

function fromUtcDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/** 某日期所属桶的起始日（UTC 日序号）。week 桶以周一为起点。 */
export function biTrendBucketStartDay(dateIso: string, grain: BiTrendGrain): number {
  const day = toUtcDay(dateIso)
  if (grain === BI_TREND_GRAINS.DAY) return day
  if (grain === BI_TREND_GRAINS.WEEK) {
    // 1970-01-05 是周一（day 4 = 1970-01-04 周日）
    const weekday = ((day % 7) + 7) % 7 // 0=周四(epoch)... 用 date 计算更直观
    const d = new Date(day * MS_PER_DAY)
    const dow = d.getUTCDay() // 0=周日
    const offset = (dow + 6) % 7 // 周一=0
    void weekday
    return day - offset
  }
  // month：当月 1 号
  const d = new Date(day * MS_PER_DAY)
  return toUtcDay(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`)
}

/** 桶的结束日（含）。 */
export function biTrendBucketEndDay(startDay: number, grain: BiTrendGrain): number {
  if (grain === BI_TREND_GRAINS.DAY) return startDay
  if (grain === BI_TREND_GRAINS.WEEK) return startDay + 6
  // month：下一月 1 号减一天
  const d = new Date(startDay * MS_PER_DAY)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const next = new Date(Date.UTC(year, month + 1, 1))
  return toUtcDay(next.toISOString().slice(0, 10)) - 1
}

/** 各粒度的名义天数（month 用平均月长）。 */
const BI_TREND_GRAIN_NOMINAL_DAYS: Record<BiTrendGrain, number> = {
  day: 1,
  week: 7,
  month: 30.44,
}

/**
 * 枚举窗口内全部桶（起始日升序）。
 * 语义：桶数 = round(窗口天数 / 粒度名义天数)（至少 1），
 * 以 referenceDate 所属桶为最后一桶向前回溯——保证 last_12_weeks 恒为 12 个周桶、
 * last_6_months 恒为 6 个月桶，与参考日期在桶内的位置无关（确定性）。
 */
export function enumerateBiTrendBuckets(
  window: BiTrendWindow,
  grain: BiTrendGrain,
  referenceDate: string,
): { bucketStart: string; bucketEnd: string }[] {
  const count = Math.max(
    1,
    Math.round(BI_TREND_WINDOW_DAYS[window] / BI_TREND_GRAIN_NOMINAL_DAYS[grain]),
  )
  const refStart = biTrendBucketStartDay(referenceDate, grain)
  const buckets: { bucketStart: string; bucketEnd: string }[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    let start: number
    if (grain === BI_TREND_GRAINS.MONTH) {
      const d = new Date(refStart * MS_PER_DAY)
      start = toUtcDay(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 10),
      )
    } else if (grain === BI_TREND_GRAINS.WEEK) {
      start = refStart - i * 7
    } else {
      start = refStart - i
    }
    buckets.push({
      bucketStart: fromUtcDay(start),
      bucketEnd: fromUtcDay(biTrendBucketEndDay(start, grain)),
    })
  }
  return buckets
}

/**
 * 桶归一化：把稀疏原始点映射到完整桶序列，缺失桶显式标记 missing=true。
 * rawPoints 以 bucketStart（或桶内任意日期）对齐；同桶多点取样本数加权的均值。
 */
export function normalizeBiTrendBuckets(
  rawPoints: { date: string; value: number; sampleCount?: number }[],
  window: BiTrendWindow,
  grain: BiTrendGrain,
  referenceDate: string,
): BiTrendPoint[] {
  const buckets = enumerateBiTrendBuckets(window, grain, referenceDate)
  const byBucket = new Map<string, { sum: number; samples: number }>()
  for (const raw of rawPoints) {
    const startDay = biTrendBucketStartDay(raw.date, grain)
    const key = fromUtcDay(startDay)
    const samples = raw.sampleCount ?? 1
    const entry = byBucket.get(key) ?? { sum: 0, samples: 0 }
    entry.sum += raw.value * samples
    entry.samples += samples
    byBucket.set(key, entry)
  }
  return buckets.map((b) => {
    const entry = byBucket.get(b.bucketStart)
    if (!entry || entry.samples === 0) {
      return {
        bucketStart: b.bucketStart,
        bucketEnd: b.bucketEnd,
        value: null,
        missing: true,
        sampleCount: 0,
      }
    }
    return {
      bucketStart: b.bucketStart,
      bucketEnd: b.bucketEnd,
      value: entry.sum / entry.samples,
      missing: false,
      sampleCount: entry.samples,
    }
  })
}

/** 移动平均：窗口内非缺失值的均值；无任何非缺失值时为 null。 */
export function computeBiTrendMovingAverage(
  points: BiTrendPoint[],
  windowSize: number = BI_TREND_MOVING_AVERAGE_WINDOW,
): (number | null)[] {
  return points.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1)
    const slice = points.slice(start, i + 1).filter((p) => !p.missing && p.value !== null)
    if (slice.length === 0) return null
    const sum = slice.reduce((acc, p) => acc + (p.value as number), 0)
    return sum / slice.length
  })
}

/**
 * 上期对比：把非缺失点分成前后两半，比较两半均值。
 * 非缺失桶不足方向判定下限时返回 null comparison。
 */
export function computeBiTrendPreviousPeriodComparison(
  points: BiTrendPoint[],
): BiTrendComparison | null {
  const present = points.filter((p) => !p.missing && p.value !== null)
  if (!isBiTrendDirectionEligible(present.length)) return null
  const half = Math.floor(present.length / 2)
  const prev = present.slice(0, half)
  const curr = present.slice(half)
  if (prev.length === 0 || curr.length === 0) return null
  const prevAvg = prev.reduce((a, p) => a + (p.value as number), 0) / prev.length
  const currAvg = curr.reduce((a, p) => a + (p.value as number), 0) / curr.length
  const delta = currAvg - prevAvg
  const deltaRatio = prevAvg === 0 ? null : delta / Math.abs(prevAvg)
  return {
    previousAverage: prevAvg,
    currentAverage: currAvg,
    delta,
    deltaRatio,
  }
}

/** 方向判定：相对变化超过 flat 阈值判 up/down；历史不足或无法比较判 unknown。 */
export function classifyBiTrendDirection(
  comparison: BiTrendComparison | null,
  flatThreshold: number = BI_TREND_DIRECTION_FLAT_THRESHOLD,
): BiTrendDirection {
  if (!comparison) return BI_TREND_DIRECTIONS.UNKNOWN
  const ratio = comparison.deltaRatio
  if (ratio === null) {
    // 上期为 0：用绝对变化兜底
    if (Math.abs(comparison.delta) < Number.EPSILON) return BI_TREND_DIRECTIONS.FLAT
    return comparison.delta > 0 ? BI_TREND_DIRECTIONS.UP : BI_TREND_DIRECTIONS.DOWN
  }
  if (Math.abs(ratio) <= flatThreshold) return BI_TREND_DIRECTIONS.FLAT
  return ratio > 0 ? BI_TREND_DIRECTIONS.UP : BI_TREND_DIRECTIONS.DOWN
}

/**
 * 异常点检测：对非缺失值计算均值与总体标准差，
 * |z| >= zThreshold 判异常。样本 <3 时不检测（返回空）。
 */
export function detectBiTrendAnomalies(
  points: BiTrendPoint[],
  zThreshold: number = BI_TREND_ANOMALY_Z_THRESHOLD,
  evidenceRefs: BiTrendEvidenceRef[] = [],
): BiTrendAnomaly[] {
  const present = points.filter((p) => !p.missing && p.value !== null)
  if (present.length < 3) return []
  const mean = present.reduce((a, p) => a + (p.value as number), 0) / present.length
  const variance =
    present.reduce((a, p) => a + ((p.value as number) - mean) ** 2, 0) / present.length
  const std = Math.sqrt(variance)
  if (std === 0) return []
  return present
    .map((p) => {
      const value = p.value as number
      const zScore = (value - mean) / std
      return { point: p, value, zScore }
    })
    .filter(({ zScore }) => Math.abs(zScore) >= zThreshold)
    .map(({ point, value, zScore }) => ({
      bucketStart: point.bucketStart,
      value,
      expected: mean,
      deviation: value - mean,
      zScore,
      direction: zScore > 0 ? ('above' as const) : ('below' as const),
      threshold: zThreshold,
      evidenceRefs,
    }))
}

/**
 * 短期线性外推：对最近非缺失点做最小二乘拟合，向前外推 horizon 个桶。
 * 历史不足（< BI_TREND_MIN_BUCKETS_FOR_FORECAST）时 suppressed=true 且不产出点。
 */
export function computeBiTrendLinearForecast(
  points: BiTrendPoint[],
  grain: BiTrendGrain,
  horizon: number = BI_TREND_FORECAST_HORIZON,
): BiTrendForecast {
  const present = points.filter((p) => !p.missing && p.value !== null)
  if (!isBiTrendForecastEligible(present.length)) {
    return {
      method: 'linear_extrapolation',
      points: [],
      suppressed: true,
      suppressionReason: BI_TREND_WARNING_CODES.INSUFFICIENT_HISTORY,
    }
  }
  const n = present.length
  const xs = present.map((_, i) => i)
  const ys = present.map((p) => p.value as number)
  const xMean = xs.reduce((a, b) => a + b, 0) / n
  const yMean = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const x = xs[i]!
    const y = ys[i]!
    num += (x - xMean) * (y - yMean)
    den += (x - xMean) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = yMean - slope * xMean

  const lastBucketStart = present[n - 1]!.bucketStart
  const forecastPoints: BiTrendForecastPoint[] = []
  let cursor = toUtcDay(lastBucketStart)
  for (let h = 1; h <= horizon; h += 1) {
    // 下一个桶
    if (grain === BI_TREND_GRAINS.MONTH) {
      const d = new Date(cursor * MS_PER_DAY)
      cursor = toUtcDay(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10),
      )
    } else {
      cursor = biTrendBucketEndDay(cursor, grain) + 1
    }
    const endDay = biTrendBucketEndDay(cursor, grain)
    forecastPoints.push({
      bucketStart: fromUtcDay(cursor),
      bucketEnd: fromUtcDay(endDay),
      value: intercept + slope * (n - 1 + h),
    })
  }
  return { method: 'linear_extrapolation', points: forecastPoints, suppressed: false }
}

// ─── 响应摘要计算 ──────────────────────────────────────────────────────────

export interface BiTrendSeriesSummaryInput {
  metricKey: BiTrendMetricKey
  grain: BiTrendGrain
  window: BiTrendWindow
  points: BiTrendPoint[]
  freshness: BiTrendFreshness
  evidenceRefs?: BiTrendEvidenceRef[]
  compareWith?: BiTrendCompareMode
  includeAnomalies?: boolean
  includeForecast?: boolean
}

/**
 * 由归一化桶序列派生完整趋势序列摘要：移动平均、上期对比、方向、
 * 异常点、外推、warning 聚合。历史不足时显式降级，绝不编造趋势。
 */
export function summarizeBiTrendSeries(input: BiTrendSeriesSummaryInput): BiTrendSeries {
  const { points } = input
  const presentCount = points.filter((p) => !p.missing).length
  const warnings: BiTrendWarning[] = []

  if (presentCount === 0) {
    warnings.push(
      buildBiTrendWarning(BI_TREND_WARNING_CODES.INSUFFICIENT_HISTORY, '窗口内无可用历史样本', {
        metricKey: input.metricKey,
      }),
    )
  } else if (!isBiTrendDirectionEligible(presentCount)) {
    warnings.push(
      buildBiTrendWarning(
        BI_TREND_WARNING_CODES.INSUFFICIENT_HISTORY,
        '历史样本不足以判定趋势方向',
        { metricKey: input.metricKey },
      ),
    )
  }
  if (points.some((p) => p.missing) && presentCount > 0) {
    warnings.push(
      buildBiTrendWarning(BI_TREND_WARNING_CODES.MISSING_BUCKETS, '窗口内存在缺失数据桶', {
        metricKey: input.metricKey,
      }),
    )
  }

  const movingAverage = computeBiTrendMovingAverage(points)
  const comparison =
    input.compareWith === BI_TREND_COMPARE_MODES.PREVIOUS_PERIOD
      ? computeBiTrendPreviousPeriodComparison(points)
      : computeBiTrendPreviousPeriodComparison(points)
  const direction = classifyBiTrendDirection(comparison)

  const anomalies = input.includeAnomalies
    ? detectBiTrendAnomalies(points, BI_TREND_ANOMALY_Z_THRESHOLD, input.evidenceRefs ?? [])
    : []

  let forecast: BiTrendForecast | undefined
  if (input.includeForecast) {
    forecast = computeBiTrendLinearForecast(points, input.grain)
    if (forecast.suppressed) {
      warnings.push(
        buildBiTrendWarning(
          BI_TREND_WARNING_CODES.FORECAST_SUPPRESSED,
          '历史样本不足，短期外推已抑制',
          { metricKey: input.metricKey },
        ),
      )
    }
  }

  return {
    metricKey: input.metricKey,
    metricVersion: BI_TREND_METRIC_VERSION,
    grain: input.grain,
    window: input.window,
    points,
    movingAverage,
    comparison: comparison ?? undefined,
    direction,
    anomalies,
    forecast,
    freshness: input.freshness,
    warnings,
    evidenceRefs: input.evidenceRefs ?? [],
    insights: [],
    sampleCount: presentCount,
  }
}

/** freshness 聚合：多来源取最差状态与平均覆盖率，并生成低敏哈希。 */
export function aggregateBiTrendFreshness(sources: BiTrendSourceRef[]): BiTrendFreshness {
  if (sources.length === 0) {
    return {
      state: BI_TREND_FRESHNESS_STATES.UNKNOWN,
      sourceCoverage: 0,
      freshnessHash: 'no-sources',
      sources: [],
    }
  }
  const order: Record<BiTrendFreshnessState, number> = { fresh: 0, stale: 1, unknown: 2 }
  const worst = sources.reduce((a, s) => (order[s.state] > order[a.state] ? s : a))
  const available = sources.filter((s) => s.state !== BI_TREND_FRESHNESS_STATES.UNKNOWN)
  const hashInput = sources
    .map((s) => `${s.sourceKind}:${s.state}:${s.lastRefreshedAt ?? 'null'}:${s.metricVersion}`)
    .join('|')
  return {
    state: worst.state,
    sourceCoverage: available.length / sources.length,
    freshnessHash: simpleBiTrendHash(hashInput),
    sources,
  }
}

/** 低敏非加密哈希（FNV-1a 32bit），仅供审计比对，不携带原始内容。 */
export function simpleBiTrendHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}
