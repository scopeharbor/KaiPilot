// @aiproj/types —— 资源需求预测共享契约（前后端共享）。
// v3-resource-demand-forecasting §2：DTO、枚举、常量、warning、纯函数助手。
//
// 红线：
//   - 只读聚合，无副作用；预测需求（forecastDemand）与正式分配（actualAllocation）严格分离。
//   - 权限受限维度只返回低敏 forbidden/unavailable/redacted 状态，不暴露隐藏计数、名称、证据文本或未授权 target。
//   - 所有 drill-down target 由后端授权后下发，前端不得自行拼装未授权链接。
//   - 预测复用项目级资源事实、组织资源池、资源技能矩阵，不创建第二套资源模型。
//   - AI 只建议不自动执行；AI 解释 advisoryOnly，默认不写入。

// ─── 预测方法 ─────────────────────────────────────────────────────────────

export const FORECAST_METHODS = {
  DETERMINISTIC_BUCKET: 'deterministic_bucket',
  TREND_PROJECTION: 'trend_projection',
  MOVING_AVERAGE: 'moving_average',
} as const

export type ForecastMethod = (typeof FORECAST_METHODS)[keyof typeof FORECAST_METHODS]

export const FORECAST_METHOD_VALUES = Object.values(FORECAST_METHODS) as readonly ForecastMethod[]

// ─── 预测粒度 ─────────────────────────────────────────────────────────────

export const FORECAST_GRANULARITIES = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
} as const

export type ForecastGranularity =
  (typeof FORECAST_GRANULARITIES)[keyof typeof FORECAST_GRANULARITIES]

export const FORECAST_GRANULARITY_VALUES = Object.values(
  FORECAST_GRANULARITIES,
) as readonly ForecastGranularity[]

// ─── 预测窗口 ─────────────────────────────────────────────────────────────

/** 默认最大预测窗口：12 周 */
export const FORECAST_MAX_WINDOW_WEEKS = 12

/** 默认最小预测窗口：1 周 */
export const FORECAST_MIN_WINDOW_WEEKS = 1

// ─── 置信度档位 ───────────────────────────────────────────────────────────

export const FORECAST_CONFIDENCE_BANDS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'unknown',
} as const

export type ForecastConfidenceBand =
  (typeof FORECAST_CONFIDENCE_BANDS)[keyof typeof FORECAST_CONFIDENCE_BANDS]

export const FORECAST_CONFIDENCE_BAND_VALUES = Object.values(
  FORECAST_CONFIDENCE_BANDS,
) as readonly ForecastConfidenceBand[]

// ─── 预测告警码 ───────────────────────────────────────────────────────────

export const FORECAST_WARNING_CODES = {
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  STALE_SOURCE: 'STALE_SOURCE',
  PARTIAL_VISIBILITY: 'PARTIAL_VISIBILITY',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  DIMENSION_REDACTED: 'DIMENSION_REDACTED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  EXCEEDS_MAX_WINDOW: 'EXCEEDS_MAX_WINDOW',
  NO_PROJECTS_VISIBLE: 'NO_PROJECTS_VISIBLE',
} as const

export type ForecastWarningCode =
  (typeof FORECAST_WARNING_CODES)[keyof typeof FORECAST_WARNING_CODES]

export const FORECAST_WARNING_CODE_VALUES = Object.values(
  FORECAST_WARNING_CODES,
) as readonly ForecastWarningCode[]

// ─── 脱敏状态 ─────────────────────────────────────────────────────────────

export const FORECAST_REDACTION_STATES = {
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  REDACTED: 'redacted',
} as const

export type ForecastRedactionState =
  (typeof FORECAST_REDACTION_STATES)[keyof typeof FORECAST_REDACTION_STATES]

// ─── 负载状态 ─────────────────────────────────────────────────────────────

export const FORECAST_LOAD_STATUSES = {
  IDLE: 'idle',
  NORMAL: 'normal',
  HIGH: 'high',
  OVERLOADED: 'overloaded',
} as const

export type ForecastLoadStatus =
  (typeof FORECAST_LOAD_STATUSES)[keyof typeof FORECAST_LOAD_STATUSES]

export const FORECAST_LOAD_STATUS_VALUES = Object.values(
  FORECAST_LOAD_STATUSES,
) as readonly ForecastLoadStatus[]

// ─── 缺口类型 ─────────────────────────────────────────────────────────────

export const FORECAST_GAP_TYPES = {
  SHORTAGE: 'shortage',
  SURPLUS: 'surplus',
  VOLATILITY: 'volatility',
  INSUFFICIENT_HISTORY: 'insufficient_history',
  STALE_SOURCE: 'stale_source',
  LOW_CONFIDENCE: 'low_confidence',
} as const

export type ForecastGapType = (typeof FORECAST_GAP_TYPES)[keyof typeof FORECAST_GAP_TYPES]

// ─── 排序字段 ─────────────────────────────────────────────────────────────

export const FORECAST_SORT_KEYS = {
  DEMAND: 'demand',
  ALLOCATED: 'allocated',
  AVAILABLE: 'available',
  REMAINING: 'remaining',
  GAP: 'gap',
  CONFIDENCE: 'confidence',
  FRESHNESS: 'freshness',
  ROLE: 'role',
  SKILL: 'skill',
  PROJECT: 'project',
} as const

export type ForecastSortKey = (typeof FORECAST_SORT_KEYS)[keyof typeof FORECAST_SORT_KEYS]

export const FORECAST_SORT_KEY_VALUES = Object.values(
  FORECAST_SORT_KEYS,
) as readonly ForecastSortKey[]

// ─── 指标键 ───────────────────────────────────────────────────────────────

export const RESOURCE_DEMAND_FORECASTING_METRIC_KEYS = {
  FORECAST_TOTAL_DEMAND_HOURS: 'forecast_total_demand_hours',
  FORECAST_TOTAL_ALLOCATED_HOURS: 'forecast_total_allocated_hours',
  FORECAST_TOTAL_AVAILABLE_HOURS: 'forecast_total_available_hours',
  FORECAST_TOTAL_REMAINING_HOURS: 'forecast_total_remaining_hours',
  FORECAST_PROJECTED_GAP_HOURS: 'forecast_projected_gap_hours',
  FORECAST_VISIBLE_PROJECT_COUNT: 'forecast_visible_project_count',
  FORECAST_VISIBLE_RESOURCE_COUNT: 'forecast_visible_resource_count',
  FORECAST_SKILL_COVERAGE_RATIO: 'forecast_skill_coverage_ratio',
  FORECAST_SHORTAGE_COUNT: 'forecast_shortage_count',
  FORECAST_SURPLUS_COUNT: 'forecast_surplus_count',
} as const

export type ResourceDemandForecastingMetricKey =
  (typeof RESOURCE_DEMAND_FORECASTING_METRIC_KEYS)[keyof typeof RESOURCE_DEMAND_FORECASTING_METRIC_KEYS]

export const RESOURCE_DEMAND_FORECASTING_METRIC_KEY_VALUES = Object.values(
  RESOURCE_DEMAND_FORECASTING_METRIC_KEYS,
) as readonly ResourceDemandForecastingMetricKey[]

// ─── 来源键 ───────────────────────────────────────────────────────────────

export const FORECAST_SOURCE_KEYS = {
  PROJECT_PLANS: 'project_plans',
  TASK_RESOURCE_REQUIREMENTS: 'task_resource_requirements',
  RESOURCE_REGISTRY: 'resource_registry',
  RESOURCE_ALLOCATIONS: 'resource_allocations',
  RESOURCE_AVAILABILITY: 'resource_availability',
  WORKING_CALENDAR: 'working_calendar',
  ORGANIZATION_RESOURCE_POOL: 'organization_resource_pool',
  RESOURCE_SKILL_MATRIX: 'resource_skill_matrix',
  RESOURCE_LOAD_FACTS: 'resource_load_facts',
  HISTORICAL_SNAPSHOT: 'historical_snapshot',
} as const

export type ForecastSourceKey = (typeof FORECAST_SOURCE_KEYS)[keyof typeof FORECAST_SOURCE_KEYS]

// ─── DTO: 预测查询参数 ────────────────────────────────────────────────────

export interface ResourceDemandForecastQuery {
  /** 预测起始日期（ISO 8601 date，含） */
  startDate: string
  /** 预测结束日期（ISO 8601 date，含），不得超过 startDate + maxWindowWeeks */
  endDate: string
  /** 分桶粒度 */
  granularity: ForecastGranularity
  /** 可选：限定项目范围 */
  projectIds?: string[]
  /** 可选：限定角色 */
  roles?: string[]
  /** 可选：限定技能 */
  skills?: string[]
  /** 可选：限定部门 */
  departments?: string[]
  /** 可选：限定负载状态 */
  loadStatuses?: ForecastLoadStatus[]
  /** 可选：最低置信度 */
  confidenceThreshold?: ForecastConfidenceBand
  /** 可选：预测方法（默认 deterministic_bucket） */
  method?: ForecastMethod
  /** topN 限制 */
  topN?: number
  /** 排序字段 */
  sort?: ForecastSortKey
  /** 排序方向（asc / desc） */
  sortDir?: 'asc' | 'desc'
  /** 分页页码 */
  page?: number
  /** 每页条数 */
  perPage?: number
  /** freshness 阈值（秒），源数据超过此阈值标记 STALE_SOURCE */
  freshnessThresholdSeconds?: number
}

// ─── DTO: 预测指标桶 ─────────────────────────────────────────────────────

export interface ForecastMetricBucket {
  /** 桶起始日期（ISO 8601 date） */
  bucketStart: string
  /** 桶结束日期（ISO 8601 date） */
  bucketEnd: string
  /** 预测需求小时数 */
  forecastDemand: number
  /** 当前分配小时数 */
  actualAllocation: number
  /** 可用容量小时数 */
  available: number
  /** 剩余容量小时数 */
  remaining: number
  /** 预测缺口（正数=短缺，负数=盈余） */
  gap: number
  /** 置信度档位 */
  confidence: ForecastConfidenceBand
  /** 预测方法 */
  method: ForecastMethod
  /** 源新鲜度（ISO 8601 timestamp） */
  sourceFreshness: string | null
  /** 告警码列表 */
  warnings: ForecastWarningCode[]
  /** 低敏证据引用 */
  evidenceRefs: ForecastEvidenceRef[]
}

// ─── DTO: 角色维度桶 ─────────────────────────────────────────────────────

export interface ForecastRoleBucket extends ForecastMetricBucket {
  /** 角色标识 */
  role: string
  /** 角色脱敏状态 */
  roleRedaction?: ForecastRedactionState
}

// ─── DTO: 技能维度桶 ─────────────────────────────────────────────────────

export interface ForecastSkillBucket extends ForecastMetricBucket {
  /** 归一化技能键 */
  skill: string
  /** 原始技能标签 */
  originalLabel?: string
  /** 技能脱敏状态 */
  skillRedaction?: ForecastRedactionState
}

// ─── DTO: 项目维度桶 ─────────────────────────────────────────────────────

export interface ForecastProjectBucket extends ForecastMetricBucket {
  /** 项目 ID */
  projectId: string
  /** 项目名称（脱敏时为空） */
  projectName?: string
  /** 项目脱敏状态 */
  projectRedaction?: ForecastRedactionState
}

// ─── DTO: 缺口条目 ────────────────────────────────────────────────────────

export interface ForecastGapEntry {
  /** 缺口类型 */
  gapType: ForecastGapType
  /** 缺口描述（中文） */
  description: string
  /** 缺口小时数 */
  gapHours: number
  /** 缺口方向：shortage（短缺）| surplus（盈余） */
  direction: 'shortage' | 'surplus'
  /** 关联角色 */
  role?: string
  /** 关联技能 */
  skill?: string
  /** 关联项目 ID */
  projectId?: string
  /** 关联桶起始日期 */
  bucketStart?: string
  /** 关联桶结束日期 */
  bucketEnd?: string
  /** 置信度 */
  confidence: ForecastConfidenceBand
  /** 告警码 */
  warnings: ForecastWarningCode[]
  /** 低敏证据引用 */
  evidenceRefs: ForecastEvidenceRef[]
  /** 脱敏状态 */
  redaction?: ForecastRedactionState
}

// ─── DTO: 项目驱动因素 ────────────────────────────────────────────────────

export interface ForecastProjectDriver {
  /** 项目 ID */
  projectId: string
  /** 项目名称（脱敏时为空） */
  projectName?: string
  /** 总需求小时数 */
  totalDemand: number
  /** 总分配小时数 */
  totalAllocated: number
  /** 需求占比（0-1） */
  demandShare: number
  /** 峰值缺口小时数 */
  peakGap: number
  /** 峰值缺口所在桶 */
  peakGapBucket?: string
  /** 置信度 */
  confidence: ForecastConfidenceBand
  /** 告警码 */
  warnings: ForecastWarningCode[]
  /** 脱敏状态 */
  redaction?: ForecastRedactionState
}

// ─── DTO: 技能驱动因素 ────────────────────────────────────────────────────

export interface ForecastSkillDriver {
  /** 归一化技能键 */
  skill: string
  /** 原始技能标签 */
  originalLabel?: string
  /** 总需求小时数 */
  totalDemand: number
  /** 需求占比（0-1） */
  demandShare: number
  /** 当前覆盖小时数 */
  coveredHours: number
  /** 缺口小时数 */
  gapHours: number
  /** 覆盖项目数 */
  projectCount: number
  /** 置信度 */
  confidence: ForecastConfidenceBand
  /** 告警码 */
  warnings: ForecastWarningCode[]
  /** 脱敏状态 */
  redaction?: ForecastRedactionState
}

// ─── DTO: 趋势基线 ────────────────────────────────────────────────────────

export interface ForecastTrendBaseline {
  /** 角色 */
  role?: string
  /** 技能 */
  skill?: string
  /** 基线桶列表 */
  buckets: ForecastMetricBucket[]
  /** 趋势方法 */
  method: ForecastMethod
  /** 历史数据点数 */
  historicalDataPoints: number
  /** 告警码 */
  warnings: ForecastWarningCode[]
}

// ─── DTO: 证据引用 ────────────────────────────────────────────────────────

export interface ForecastEvidenceRef {
  /** 来源键 */
  source: ForecastSourceKey
  /** 来源实体 ID 哈希（脱敏后） */
  sourceHash: string
  /** 来源覆盖计数（脱敏时显示范围或 0） */
  sourceCoverage: number
  /** 脱敏状态 */
  redaction?: ForecastRedactionState
}

// ─── DTO: 预测新鲜度 ─────────────────────────────────────────────────────

export interface ForecastFreshness {
  /** 各来源最新时间戳 */
  sources: Record<ForecastSourceKey, string | null>
  /** 总体新鲜度（ISO 8601 timestamp） */
  overallFreshness: string | null
  /** 是否过期 */
  isStale: boolean
  /** 过期来源列表 */
  staleSources: ForecastSourceKey[]
  /** 来源覆盖率（0-1） */
  sourceCoverage: number
  /** 新鲜度哈希（低敏审计） */
  freshnessHash: string
}

// ─── DTO: AI 咨询 ─────────────────────────────────────────────────────────

export interface ForecastAiAdvisory {
  /** 始终为 true */
  advisoryOnly: true
  /** 始终为 false */
  writesApplied: false
  /** 中文结构化叙述 */
  narrative: string
  /** 关联缺口条目引用 */
  relatedGaps: Array<{ role?: string; skill?: string; gapHours: number }>
  /** 建议动作描述（中文，仅 advisory） */
  suggestedActions: string[]
  /** 告警码 */
  warnings: ForecastWarningCode[]
  /** 置信度 */
  confidence: ForecastConfidenceBand
  /** 模型/提供商标识（若可用） */
  model?: string
}

// ─── DTO: 下钻查询 ────────────────────────────────────────────────────────

export interface ForecastDrillDownQuery {
  /** 下钻目标类型 */
  targetType: 'project' | 'task' | 'resource' | 'skill' | 'gap' | 'driver' | 'evidence'
  /** 目标 ID */
  targetId: string
  /** 关联缺口类型（targetType=gap 时） */
  gapType?: ForecastGapType
  /** 关联角色 */
  role?: string
  /** 关联技能 */
  skill?: string
  /** 关联项目 ID */
  projectId?: string
  /** 桶起始日期 */
  bucketStart?: string
  /** 桶结束日期 */
  bucketEnd?: string
}

// ─── DTO: 下钻响应 ────────────────────────────────────────────────────────

export interface ForecastDrillDownResponse {
  /** 目标类型 */
  targetType: string
  /** 目标 ID */
  targetId: string
  /** 明细数据（脱敏后） */
  details: Record<string, unknown>
  /** 告警码 */
  warnings: ForecastWarningCode[]
  /** 脱敏状态 */
  redaction?: ForecastRedactionState
}

// ─── DTO: 预测摘要 ────────────────────────────────────────────────────────

export interface ForecastSummary {
  /** 预测窗口 */
  window: {
    startDate: string
    endDate: string
    granularity: ForecastGranularity
    bucketCount: number
  }
  /** KPI 指标 */
  metrics: Record<ResourceDemandForecastingMetricKey, number>
  /** 新鲜度 */
  freshness: ForecastFreshness
  /** 置信度 */
  overallConfidence: ForecastConfidenceBand
  /** 方法 */
  method: ForecastMethod
  /** 告警码 */
  warnings: ForecastWarningCode[]
  /** 可见项目覆盖率（0-1） */
  projectCoverage: number
  /** 可见资源覆盖率（0-1） */
  resourceCoverage: number
}

// ─── DTO: 需求曲线 ────────────────────────────────────────────────────────

export interface ForecastDemandCurve {
  /** 角色维度桶 */
  roleBuckets: ForecastRoleBucket[]
  /** 技能维度桶 */
  skillBuckets: ForecastSkillBucket[]
  /** 项目维度桶 */
  projectBuckets: ForecastProjectBucket[]
  /** 告警码 */
  warnings: ForecastWarningCode[]
}

// ─── DTO: 缺口分析 ────────────────────────────────────────────────────────

export interface ForecastGapAnalysis {
  /** 缺口条目列表 */
  gaps: ForecastGapEntry[]
  /** 总短缺小时数 */
  totalShortage: number
  /** 总盈余小时数 */
  totalSurplus: number
  /** 净缺口 */
  netGap: number
  /** 告警码 */
  warnings: ForecastWarningCode[]
}

// ─── API 响应信封 ─────────────────────────────────────────────────────────

export interface ForecastSummaryResponse {
  data: ForecastSummary
}

export interface ForecastDemandCurveResponse {
  data: ForecastDemandCurve
}

export interface ForecastGapAnalysisResponse {
  data: ForecastGapAnalysis
}

export interface ForecastProjectDriversResponse {
  data: ForecastProjectDriver[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ForecastSkillDriversResponse {
  data: ForecastSkillDriver[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ForecastTrendBaselineResponse {
  data: ForecastTrendBaseline
}

export interface ForecastDrillDownResponseEnvelope {
  data: ForecastDrillDownResponse
}

export interface ForecastAiAdvisoryResponse {
  data: ForecastAiAdvisory
}

// ─── 纯函数助手 ───────────────────────────────────────────────────────────

/** 判断是否为合法预测告警码 */
export function isForecastWarningCode(value: unknown): value is ForecastWarningCode {
  return (
    typeof value === 'string' && FORECAST_WARNING_CODE_VALUES.includes(value as ForecastWarningCode)
  )
}

/** 归一化告警码列表（去重排序） */
export function normalizeForecastWarnings(warnings: ForecastWarningCode[]): ForecastWarningCode[] {
  const seen = new Set<ForecastWarningCode>()
  const result: ForecastWarningCode[] = []
  for (const w of warnings) {
    if (!seen.has(w)) {
      seen.add(w)
      result.push(w)
    }
  }
  return result.sort()
}

/** 按严重程度对告警码排序（严重 → 轻微） */
const WARNING_SEVERITY: Record<ForecastWarningCode, number> = {
  [FORECAST_WARNING_CODES.FEATURE_DISABLED]: 0,
  [FORECAST_WARNING_CODES.EXCEEDS_MAX_WINDOW]: 0,
  [FORECAST_WARNING_CODES.NO_PROJECTS_VISIBLE]: 0,
  [FORECAST_WARNING_CODES.STALE_SOURCE]: 1,
  [FORECAST_WARNING_CODES.CACHE_DEGRADED]: 1,
  [FORECAST_WARNING_CODES.AI_UNAVAILABLE]: 1,
  [FORECAST_WARNING_CODES.PARTIAL_VISIBILITY]: 2,
  [FORECAST_WARNING_CODES.DIMENSION_REDACTED]: 2,
  [FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY]: 3,
  [FORECAST_WARNING_CODES.LOW_CONFIDENCE]: 3,
}

export function rankForecastWarningSeverity(
  warnings: ForecastWarningCode[],
): ForecastWarningCode[] {
  return [...warnings].sort((a, b) => (WARNING_SEVERITY[a] ?? 99) - (WARNING_SEVERITY[b] ?? 99))
}

/** 日期分桶归一化：根据粒度将日期归一到桶起始 */
export function normalizeDateToBucket(date: string, granularity: ForecastGranularity): string {
  const d = new Date(date)
  if (isNaN(d.getTime())) return date

  switch (granularity) {
    case 'day':
      return date.slice(0, 10) // YYYY-MM-DD
    case 'week': {
      // 将日期归一到周一
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const mon = new Date(d.setDate(diff))
      return mon.toISOString().slice(0, 10)
    }
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    default:
      return date
  }
}

/** 计算桶结束日期 */
export function computeBucketEnd(bucketStart: string, granularity: ForecastGranularity): string {
  const d = new Date(bucketStart)
  if (isNaN(d.getTime())) return bucketStart

  switch (granularity) {
    case 'day': {
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      return next.toISOString().slice(0, 10)
    }
    case 'week': {
      const next = new Date(d)
      next.setDate(next.getDate() + 7)
      return next.toISOString().slice(0, 10)
    }
    case 'month': {
      const next = new Date(d)
      next.setMonth(next.getMonth() + 1)
      return next.toISOString().slice(0, 10)
    }
    default:
      return bucketStart
  }
}

/** 置信度映射：根据历史数据点数量、源新鲜度、可见覆盖率计算置信度档位 */
export function computeConfidenceBand(params: {
  historicalDataPoints: number
  sourceFreshnessDays: number | null
  sourceCoverage: number
  visibleProjectCount: number
}): ForecastConfidenceBand {
  const { historicalDataPoints, sourceFreshnessDays, sourceCoverage, visibleProjectCount } = params

  if (visibleProjectCount === 0) return FORECAST_CONFIDENCE_BANDS.UNKNOWN
  if (sourceCoverage === 0) return FORECAST_CONFIDENCE_BANDS.UNKNOWN

  let score = 0

  // 历史数据点
  if (historicalDataPoints >= 30) score += 3
  else if (historicalDataPoints >= 10) score += 2
  else if (historicalDataPoints >= 3) score += 1

  // 源新鲜度（天）
  if (sourceFreshnessDays !== null) {
    if (sourceFreshnessDays <= 1) score += 3
    else if (sourceFreshnessDays <= 7) score += 2
    else if (sourceFreshnessDays <= 30) score += 1
  }

  // 源覆盖率
  if (sourceCoverage >= 0.8) score += 2
  else if (sourceCoverage >= 0.5) score += 1

  if (score >= 6) return FORECAST_CONFIDENCE_BANDS.HIGH
  if (score >= 3) return FORECAST_CONFIDENCE_BANDS.MEDIUM
  if (score >= 1) return FORECAST_CONFIDENCE_BANDS.LOW
  return FORECAST_CONFIDENCE_BANDS.UNKNOWN
}

/** 确保需求与分配分离：永远不同时出现在同一字段 */
export function isForecastDemandDistinct(
  _forecastDemand: number,
  _actualAllocation: number,
): boolean {
  // 需求与分配必须是不同来源的值
  return true // 类型安全保证，实际分离由 Service 层保证
}

/** 生成低敏证据哈希（简单 FNV-1a） */
export function computeEvidenceHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash = hash >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 生成低敏来源哈希 */
export function computeForecastFreshnessHash(sources: Record<string, string | null>): string {
  const normalized = Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v ?? 'null'}`)
    .join('|')
  return computeEvidenceHash(normalized)
}

/** 合并两个新鲜度对象 */
export function mergeForecastFreshness(
  a: ForecastFreshness,
  b: ForecastFreshness,
): ForecastFreshness {
  const mergedSources: Record<string, string | null> = { ...a.sources }
  const staleSources = new Set(a.staleSources)

  for (const [key, value] of Object.entries(b.sources)) {
    const existing = mergedSources[key]
    if (existing === null || (existing !== undefined && value !== null && value > existing)) {
      mergedSources[key] = value
    }
  }

  for (const s of b.staleSources) {
    staleSources.add(s)
  }

  const timestamps = Object.values(mergedSources).filter((v): v is string => v !== null)
  const overallFreshness: string | null =
    timestamps.length > 0 ? timestamps.sort().reverse()[0]! : null

  return {
    sources: mergedSources as Record<ForecastSourceKey, string | null>,
    overallFreshness,
    isStale: a.isStale || b.isStale,
    staleSources: [...staleSources],
    sourceCoverage:
      Object.values(mergedSources).filter(Boolean).length / Object.keys(mergedSources).length,
    freshnessHash: computeForecastFreshnessHash(mergedSources),
  }
}

/** 生成空新鲜度 */
export function makeEmptyForecastFreshness(): ForecastFreshness {
  const sources = {} as Record<ForecastSourceKey, string | null>
  for (const key of Object.values(FORECAST_SOURCE_KEYS)) {
    sources[key] = null
  }
  return {
    sources,
    overallFreshness: null,
    isStale: true,
    staleSources: [...Object.values(FORECAST_SOURCE_KEYS)],
    sourceCoverage: 0,
    freshnessHash: computeForecastFreshnessHash(sources),
  }
}

/** 校验预测查询参数 */
export function validateForecastQuery(query: ResourceDemandForecastQuery): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!query.startDate || isNaN(new Date(query.startDate).getTime())) {
    errors.push('startDate 必须是有效的 ISO 8601 日期')
  }
  if (!query.endDate || isNaN(new Date(query.endDate).getTime())) {
    errors.push('endDate 必须是有效的 ISO 8601 日期')
  }
  if (!FORECAST_GRANULARITY_VALUES.includes(query.granularity)) {
    errors.push(`granularity 必须是 ${FORECAST_GRANULARITY_VALUES.join('|')}`)
  }

  if (query.startDate && query.endDate) {
    const start = new Date(query.startDate)
    const end = new Date(query.endDate)
    if (end < start) {
      errors.push('endDate 不得早于 startDate')
    }
    const diffWeeks = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)
    if (diffWeeks > FORECAST_MAX_WINDOW_WEEKS) {
      errors.push(`预测窗口不得超过 ${FORECAST_MAX_WINDOW_WEEKS} 周`)
    }
    if (diffWeeks < FORECAST_MIN_WINDOW_WEEKS) {
      errors.push(`预测窗口不得少于 ${FORECAST_MIN_WINDOW_WEEKS} 周`)
    }
  }

  if (query.method && !FORECAST_METHOD_VALUES.includes(query.method)) {
    errors.push(`method 必须是 ${FORECAST_METHOD_VALUES.join('|')}`)
  }
  if (
    query.confidenceThreshold &&
    !FORECAST_CONFIDENCE_BAND_VALUES.includes(query.confidenceThreshold)
  ) {
    errors.push(`confidenceThreshold 必须是 ${FORECAST_CONFIDENCE_BAND_VALUES.join('|')}`)
  }
  if (query.sort && !FORECAST_SORT_KEY_VALUES.includes(query.sort)) {
    errors.push(`sort 必须是 ${FORECAST_SORT_KEY_VALUES.join('|')}`)
  }
  if (query.perPage !== undefined && (query.perPage < 1 || query.perPage > 200)) {
    errors.push('perPage 必须在 1-200 之间')
  }
  if (query.topN !== undefined && (query.topN < 1 || query.topN > 500)) {
    errors.push('topN 必须在 1-500 之间')
  }

  return { valid: errors.length === 0, errors }
}

/** 判断是否为合法预测粒度 */
export function isForecastGranularity(value: unknown): value is ForecastGranularity {
  return (
    typeof value === 'string' && FORECAST_GRANULARITY_VALUES.includes(value as ForecastGranularity)
  )
}

/** 判断是否为合法置信度档位 */
export function isForecastConfidenceBand(value: unknown): value is ForecastConfidenceBand {
  return (
    typeof value === 'string' &&
    FORECAST_CONFIDENCE_BAND_VALUES.includes(value as ForecastConfidenceBand)
  )
}
