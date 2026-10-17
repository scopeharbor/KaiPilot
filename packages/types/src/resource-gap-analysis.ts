// @aiproj/types —— 资源缺口分析共享契约（前后端共享）。
// v3-resource-gap-analysis §2：维度、口径、严重度、原因码、query/response、warning、evidence、metricVersion。
//
// 红线：
//   - 只读聚合，无副作用；不含财务/预算/ROI/成本一等字段。
//   - 所有口径从已授权事实（分配/负载/技能矩阵/资源池/预测/争用）只读读取。
//   - 缺口原因码使用封闭枚举，保证前后端一致性。
//   - AI 解释默认 fixture/mock，不启用真实模型。
//   - 低敏 evidence 只存 hash + source key + 授权 id + timestamp。
//   - 本文件零运行时依赖，纯 TypeScript 类型 + 确定性纯函数。

// ─── Metric Version ──────────────────────────────────────────────────────────

export const RESOURCE_GAP_ANALYSIS_METRIC_VERSION = 'resource-gap-analysis@1' as const

// ─── 维度枚举 ──────────────────────────────────────────────────────────────

export const RESOURCE_GAP_DIMENSIONS = {
  ROLE: 'role',
  SKILL: 'skill',
  TIME_BUCKET: 'timeBucket',
  PROJECT: 'project',
  PORTFOLIO: 'portfolio',
  ORGANIZATION: 'organization',
} as const

export type ResourceGapDimension =
  (typeof RESOURCE_GAP_DIMENSIONS)[keyof typeof RESOURCE_GAP_DIMENSIONS]

export const RESOURCE_GAP_DIMENSION_VALUES = Object.values(
  RESOURCE_GAP_DIMENSIONS,
) as readonly ResourceGapDimension[]

// ─── 口径枚举 ──────────────────────────────────────────────────────────────

export const RESOURCE_GAP_METRICS = {
  ALLOCATED_VS_DEMAND: 'allocated_vs_demand',
  AVAILABLE_VS_DEMAND: 'available_vs_demand',
  SKILL_SHORTFALL: 'skill_shortfall',
  FORECAST_GAP: 'forecast_gap',
} as const

export type ResourceGapMetric = (typeof RESOURCE_GAP_METRICS)[keyof typeof RESOURCE_GAP_METRICS]

export const RESOURCE_GAP_METRIC_VALUES = Object.values(
  RESOURCE_GAP_METRICS,
) as readonly ResourceGapMetric[]

// ─── 严重度枚举 ────────────────────────────────────────────────────────────

export const RESOURCE_GAP_SEVERITIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none',
} as const

export type ResourceGapSeverity =
  (typeof RESOURCE_GAP_SEVERITIES)[keyof typeof RESOURCE_GAP_SEVERITIES]

export const RESOURCE_GAP_SEVERITY_VALUES = Object.values(
  RESOURCE_GAP_SEVERITIES,
) as readonly ResourceGapSeverity[]

/** 严重度排序权重：数字越小越严重 */
export const RESOURCE_GAP_SEVERITY_ORDER: Record<ResourceGapSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}

// ─── 原因码枚举（封闭，至少 7 个）───────────────────────────────────────

export const RESOURCE_GAP_REASON_CODES = {
  /** 组织中不存在具有所需技能的资源 */
  NO_CANDIDATE_RESOURCE: 'NO_CANDIDATE_RESOURCE',
  /** 所有候选资源当前已过载 */
  CANDIDATES_OVERLOADED: 'CANDIDATES_OVERLOADED',
  /** 整个组织中此技能持有者不足 */
  SKILL_ORG_WIDE_SHORTAGE: 'SKILL_ORG_WIDE_SHORTAGE',
  /** 候选资源在所需时间窗口内存在分配冲突 */
  ALLOC_CONFLICT: 'ALLOC_CONFLICT',
  /** 候选资源被更高优先级项目挤占 */
  PRIORITY_CROWDING: 'PRIORITY_CROWDING',
  /** 候选资源存在工作日历例外（休假/出差/兼职） */
  AVAILABILITY_EXCEPTION: 'AVAILABILITY_EXCEPTION',
  /** 预测置信度过低导致缺口估计不确定 */
  FORECAST_UNCERTAIN: 'FORECAST_UNCERTAIN',
} as const

export type ResourceGapReasonCode =
  (typeof RESOURCE_GAP_REASON_CODES)[keyof typeof RESOURCE_GAP_REASON_CODES]

export const RESOURCE_GAP_REASON_CODE_VALUES = Object.values(
  RESOURCE_GAP_REASON_CODES,
) as readonly ResourceGapReasonCode[]

/** 原因码优先级排序：数字越小优先级越高，前端渲染时按此顺序排列 */
export const RESOURCE_GAP_REASON_PRIORITY: Record<ResourceGapReasonCode, number> = {
  NO_CANDIDATE_RESOURCE: 0,
  SKILL_ORG_WIDE_SHORTAGE: 1,
  CANDIDATES_OVERLOADED: 2,
  ALLOC_CONFLICT: 3,
  PRIORITY_CROWDING: 4,
  AVAILABILITY_EXCEPTION: 5,
  FORECAST_UNCERTAIN: 6,
}

/** 原因码中文标签映射 */
export const RESOURCE_GAP_REASON_LABELS: Record<ResourceGapReasonCode, string> = {
  NO_CANDIDATE_RESOURCE: '无候选资源',
  CANDIDATES_OVERLOADED: '候选资源已过载',
  SKILL_ORG_WIDE_SHORTAGE: '全组织技能短缺',
  ALLOC_CONFLICT: '分配冲突',
  PRIORITY_CROWDING: '优先级挤占',
  AVAILABILITY_EXCEPTION: '可用性例外',
  FORECAST_UNCERTAIN: '预测不确定',
}

// ─── 查询类型枚举 ──────────────────────────────────────────────────────────

export const RESOURCE_GAP_QUERY_TYPES = {
  SUMMARY: 'summary',
  BY_ROLE: 'by-role',
  BY_SKILL: 'by-skill',
  BY_TIMEBUCKET: 'by-timebucket',
  BY_PROJECT: 'by-project',
  BY_PORTFOLIO: 'by-portfolio',
  EXPLANATION: 'explanation',
  DRILL_DOWN: 'drill-down',
} as const

export type ResourceGapQueryType =
  (typeof RESOURCE_GAP_QUERY_TYPES)[keyof typeof RESOURCE_GAP_QUERY_TYPES]

export const RESOURCE_GAP_QUERY_TYPE_VALUES = Object.values(
  RESOURCE_GAP_QUERY_TYPES,
) as readonly ResourceGapQueryType[]

// ─── Warning Codes ──────────────────────────────────────────────────────────

export const RESOURCE_GAP_WARNING_CODES = {
  /** 上游能力不可用 */
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  /** 缓存降级 */
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  /** 结果截断 */
  RESULT_TRUNCATED: 'RESULT_TRUNCATED',
  /** 权限脱敏 */
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  /** AI 未启用 */
  AI_DISABLED: 'AI_DISABLED',
  /** AI 解释低置信度 */
  AI_EXPLANATION_LOW_CONFIDENCE: 'AI_EXPLANATION_LOW_CONFIDENCE',
  /** 数据陈旧 */
  SOURCE_STALE: 'SOURCE_STALE',
  /** 低基数脱敏 */
  LOW_CARDINALITY_REDACTED: 'LOW_CARDINALITY_REDACTED',
  /** 空组织 */
  EMPTY_ORGANIZATION: 'EMPTY_ORGANIZATION',
  /** 预测口径不可用（上游未部署） */
  FORECAST_UNAVAILABLE: 'FORECAST_UNAVAILABLE',
  /** 争用口径不可用（上游未部署） */
  CONTENTION_UNAVAILABLE: 'CONTENTION_UNAVAILABLE',
} as const

export type ResourceGapWarningCode =
  (typeof RESOURCE_GAP_WARNING_CODES)[keyof typeof RESOURCE_GAP_WARNING_CODES]

export const RESOURCE_GAP_WARNING_CODE_VALUES = Object.values(
  RESOURCE_GAP_WARNING_CODES,
) as readonly ResourceGapWarningCode[]

// ─── Constants ──────────────────────────────────────────────────────────────

export const RESOURCE_GAP_DEFAULT_PAGE = 1
export const RESOURCE_GAP_DEFAULT_PER_PAGE = 20
export const RESOURCE_GAP_MAX_PER_PAGE = 100
export const RESOURCE_GAP_DEFAULT_TOP_N = 10
export const RESOURCE_GAP_MAX_TOP_N = 50
export const RESOURCE_GAP_DEFAULT_DATE_WINDOW_DAYS = 84 // 12 weeks
export const RESOURCE_GAP_MAX_DATE_WINDOW_DAYS = 366
export const RESOURCE_GAP_DEFAULT_REASON_TOP_N = 3
export const RESOURCE_GAP_MAX_REASON_TOP_N = 7
export const RESOURCE_GAP_MAX_PORTFOLIO_IDS = 20
export const RESOURCE_GAP_MAX_SKILL_KEYS = 50
export const RESOURCE_GAP_MAX_PROJECT_IDS = 50

// ─── DTO: Query ─────────────────────────────────────────────────────────────

export interface ResourceGapQuery {
  /** 日期窗口起始（ISO 8601），默认 12 周前 */
  from?: string
  /** 日期窗口结束（ISO 8601），默认今天 */
  to?: string
  /** 查询类型 */
  type?: ResourceGapQueryType
  /** 口径过滤（可多选，空=全部可用口径） */
  metrics?: ResourceGapMetric[]
  /** 严重度过滤 */
  severity?: ResourceGapSeverity
  /** 维度过滤 */
  dimension?: ResourceGapDimension
  /** 限定项目 ID 列表 */
  projectIds?: number[]
  /** 限定技能 key 列表 */
  skillKeys?: string[]
  /** 限定角色列表 */
  roles?: string[]
  /** 限定组合 ID 列表 */
  portfolioIds?: string[]
  /** 时间桶粒度（ISO week = 'iso_week'，calendar month = 'month'） */
  timeBucketGranularity?: 'day' | 'iso_week' | 'month'
  /** top N 返回数 */
  topN?: number
  /** 原因码 top N */
  reasonTopN?: number
  /** 搜索关键词 */
  search?: string
  /** 排序字段 */
  sort?: 'severity' | 'gap_hours' | 'skill_key' | 'project_name' | 'role' | 'date'
  /** 排序方向 */
  order?: 'asc' | 'desc'
  /** 分页 */
  page?: number
  perPage?: number
}

export interface NormalizedResourceGapQuery {
  from: string
  to: string
  type: ResourceGapQueryType
  metrics: ResourceGapMetric[] | null
  severity: ResourceGapSeverity | null
  dimension: ResourceGapDimension | null
  projectIds: number[] | null
  skillKeys: string[] | null
  roles: string[] | null
  portfolioIds: string[] | null
  timeBucketGranularity: 'day' | 'iso_week' | 'month'
  topN: number
  reasonTopN: number
  search: string | null
  sort: string
  order: 'asc' | 'desc'
  page: number
  perPage: number
}

// ─── DTO: Warning ───────────────────────────────────────────────────────────

export interface ResourceGapWarning {
  code: ResourceGapWarningCode
  message: string
  metric?: ResourceGapMetric
  dimension?: ResourceGapDimension
  detail?: string
}

// ─── DTO: Evidence ──────────────────────────────────────────────────────────

export interface ResourceGapEvidence {
  /** 来源类型 */
  kind:
    'allocation' | 'capacity' | 'skill_matrix' | 'demand_forecast' | 'contention' | 'resource_pool'
  /** 来源键（低敏，不含 PII） */
  sourceKey: string
  /** 关联目标 ID 列表（低敏，不含名称） */
  targetIds: number[]
  /** 稳定哈希（用于审计校验） */
  hash: string
  /** 证据生成时间 */
  timestamp: string
}

// ─── DTO: Reason ────────────────────────────────────────────────────────────

export interface ResourceGapReason {
  /** 原因码 */
  code: ResourceGapReasonCode
  /** 中文标签 */
  label: string
  /** 优先级排序位置 */
  priority: number
  /** 低敏证据引用 */
  evidenceRefs: ResourceGapEvidence[]
  /** 规则模板解释文本 */
  explanation: string
}

// ─── DTO: Gap Entry（单条缺口） ───────────────────────────────────────────

export interface ResourceGapEntry {
  /** 缺口稳定 ID（hash-based） */
  gapId: string
  /** 维度 */
  dimension: ResourceGapDimension
  /** 维度值（角色名 / 技能 key / ISO week / 项目 ID / 组合 ID / org ID） */
  dimensionValue: string
  /** 维度显示标签 */
  dimensionLabel: string
  /** 口径 */
  metric: ResourceGapMetric
  /** 严重度 */
  severity: ResourceGapSeverity
  /** 需求容量（小时） */
  demandHours: number
  /** 供给容量（小时） */
  supplyHours: number
  /** 缺口容量（小时） */
  gapHours: number
  /** 缺口比例（0-1，gapHours / demandHours） */
  gapRatio: number
  /** 时间窗口 */
  dateWindow: { from: string; to: string } | null
  /** Top-N 缺口原因（按优先级排序） */
  reasons: ResourceGapReason[]
  /** 关联警告 */
  warnings: ResourceGapWarning[]
  /** 是否脱敏 */
  redacted: boolean
}

// ─── DTO: Summary ───────────────────────────────────────────────────────────

export interface ResourceGapSummary {
  meta: ResourceGapMeta
  /** 总缺口数 */
  totalGaps: number
  /** 严重度分布 */
  severityDistribution: Record<ResourceGapSeverity, number>
  /** 口径分布 */
  metricDistribution: Record<ResourceGapMetric, number>
  /** 维度分布 */
  dimensionDistribution: Record<ResourceGapDimension, number>
  /** 总需求容量（小时） */
  totalDemandHours: number
  /** 总供给容量（小时） */
  totalSupplyHours: number
  /** 总缺口容量（小时） */
  totalGapHours: number
  /** 平均缺口比率 */
  averageGapRatio: number
  /** Top-N 最严重缺口 */
  topGaps: ResourceGapEntry[]
  /** 警告 */
  warnings: ResourceGapWarning[]
}

// ─── DTO: By-Dimension Response ─────────────────────────────────────────────

export interface ResourceGapDimensionResponse {
  meta: ResourceGapMeta
  dimension: ResourceGapDimension
  gaps: ResourceGapEntry[]
  warnings: ResourceGapWarning[]
}

// ─── DTO: Explanation Response ──────────────────────────────────────────────

export interface ResourceGapExplanation {
  gapId: string
  /** 规则模板解释 */
  ruleExplanation: string
  /** AI 增强解释（可能为 null 如果 AI 不可用/低置信度） */
  aiExplanation: string | null
  /** AI 置信度（0-1），AI 不可用时为 null */
  aiConfidence: number | null
  /** 建议动作（只做 preview，不自动执行） */
  suggestedActions: ResourceGapSuggestedAction[]
  /** 跳转到既有写入链路的 CTA */
  actionLinks: ResourceGapActionLink[]
  /** 低敏证据 */
  evidenceRefs: ResourceGapEvidence[]
  /** 关联警告 */
  warnings: ResourceGapWarning[]
}

/** 建议动作（只做 preview） */
export interface ResourceGapSuggestedAction {
  /** 动作类型 */
  actionType:
    | 'reallocate'
    | 'hire'
    | 'reschedule'
    | 'reprioritize'
    | 'skill_development'
    | 'external_resource'
  /** 中文描述 */
  description: string
  /** 预估影响（小时） */
  estimatedImpactHours: number | null
  /** 所需角色/技能 */
  targetRole: string | null
  targetSkill: string | null
}

/** 跳转链接（到既有写入链路） */
export interface ResourceGapActionLink {
  /** 链接标签 */
  label: string
  /** 目标 URL（相对路径） */
  href: string
  /** 目标能力 */
  targetCapability: string
}

// ─── DTO: Drill-Down Response ───────────────────────────────────────────────

export interface ResourceGapDrillDownResponse {
  meta: ResourceGapMeta
  gapId: string
  /** 下钻条目 */
  items: ResourceGapDrillDownItem[]
  /** 来源能力 */
  sourceCapability: string
  /** 授权判定 */
  authorization: {
    authorized: boolean
    reason?: string
  }
  warnings: ResourceGapWarning[]
}

export interface ResourceGapDrillDownItem {
  itemId: number
  itemType: 'resource' | 'task' | 'project' | 'portfolio' | 'allocation' | 'contention' | 'forecast'
  itemName: string | null // null when redacted
  details: Record<string, unknown>
  redacted: boolean
}

// ─── DTO: Meta ──────────────────────────────────────────────────────────────

export interface ResourceGapMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  querySignatureHash: string
  visibleProjectCount: number
  visibleResourceCount: number
  dateWindow: { from: string; to: string }
  /** 上游能力可用性 */
  upstreamAvailability: {
    demandForecasting: boolean
    contentionDetection: boolean
    skillMatrix: boolean
    resourcePool: boolean
  }
  /** 数据新鲜度 */
  sourceFreshness: {
    allocation?: string | null
    capacity?: string | null
    skillMatrix?: string | null
    demandForecast?: string | null
    contention?: string | null
  }
}

// ─── DTO: Read Audit ────────────────────────────────────────────────────────

export interface ResourceGapReadAudit {
  actorId: number
  organizationId: number
  queryType: ResourceGapQueryType
  querySignatureHash: string
  metricVersion: string
  redacted: boolean
  warningCodes: ResourceGapWarningCode[]
  occurredAt: string
}

// ─── DTO: Response Envelope ─────────────────────────────────────────────────

export interface ResourceGapEnvelope<T> {
  data: T
  meta: {
    total?: number
    page?: number
    perPage?: number
    totalPages?: number
  }
  warnings?: ResourceGapWarning[]
}

// ─── 纯函数 ─────────────────────────────────────────────────────────────────

/** 稳定哈希（FNV-1a） */
export function resourceGapStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 严格 float 两位小数 */
export function resourceGapRoundTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** clamp 工具函数 */
export function resourceGapClamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** 严重度比较：a 比 b 更严重返回负数 */
export function compareGapSeverity(a: ResourceGapSeverity, b: ResourceGapSeverity): number {
  return RESOURCE_GAP_SEVERITY_ORDER[a] - RESOURCE_GAP_SEVERITY_ORDER[b]
}

/** 原因码优先级比较 */
export function compareReasonPriority(a: ResourceGapReasonCode, b: ResourceGapReasonCode): number {
  return RESOURCE_GAP_REASON_PRIORITY[a] - RESOURCE_GAP_REASON_PRIORITY[b]
}

/** 按优先级排序原因码 */
export function sortReasonsByPriority(reasons: ResourceGapReasonCode[]): ResourceGapReasonCode[] {
  return [...reasons].sort((a, b) => compareReasonPriority(a, b))
}

/** 生成缺口稳定 ID */
export function makeResourceGapId(input: {
  organizationId: number
  dimension: ResourceGapDimension
  dimensionValue: string
  metric: ResourceGapMetric
  dateWindow: { from: string; to: string } | null
}): string {
  return resourceGapStableHash(
    `${input.organizationId}:${input.dimension}:${input.dimensionValue}:${input.metric}:${input.dateWindow?.from ?? ''}:${input.dateWindow?.to ?? ''}`,
  )
}

/** 生成证据哈希 */
export function makeResourceGapEvidenceHash(evidence: Omit<ResourceGapEvidence, 'hash'>): string {
  return resourceGapStableHash(
    `${evidence.kind}:${evidence.sourceKey}:${evidence.targetIds.join(',')}:${evidence.timestamp}`,
  )
}

/** 生成查询签名哈希 */
export function makeResourceGapQuerySignatureHash(query: NormalizedResourceGapQuery): string {
  return resourceGapStableHash(
    `${query.from}:${query.to}:${query.type}:${(query.metrics ?? []).join(',')}:${query.severity ?? ''}:${query.dimension ?? ''}`,
  )
}

/** 归一化查询：类型白名单、日期窗口 clamp、分页 clamp、topN clamp */
export function normalizeResourceGapQuery(
  query: ResourceGapQuery = {},
): NormalizedResourceGapQuery {
  const now = new Date()
  const defaultFrom = new Date(
    now.getTime() - RESOURCE_GAP_DEFAULT_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10)

  let from = query.from ?? defaultFrom
  let to = query.to ?? now.toISOString().slice(0, 10)

  // Clamp date window
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
    const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24)
    if (diffDays > RESOURCE_GAP_MAX_DATE_WINDOW_DAYS) {
      to = new Date(fromMs + RESOURCE_GAP_MAX_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    }
  }

  return {
    from,
    to,
    type:
      query.type && RESOURCE_GAP_QUERY_TYPE_VALUES.includes(query.type)
        ? query.type
        : RESOURCE_GAP_QUERY_TYPES.SUMMARY,
    metrics: query.metrics?.length
      ? query.metrics.filter((m) => RESOURCE_GAP_METRIC_VALUES.includes(m))
      : null,
    severity:
      query.severity && RESOURCE_GAP_SEVERITY_VALUES.includes(query.severity)
        ? query.severity
        : null,
    dimension:
      query.dimension && RESOURCE_GAP_DIMENSION_VALUES.includes(query.dimension)
        ? query.dimension
        : null,
    projectIds: query.projectIds?.length
      ? query.projectIds.slice(0, RESOURCE_GAP_MAX_PROJECT_IDS).filter((n) => Number.isFinite(n))
      : null,
    skillKeys: query.skillKeys?.length
      ? query.skillKeys.slice(0, RESOURCE_GAP_MAX_SKILL_KEYS).filter((s) => s.trim())
      : null,
    roles: query.roles?.length ? query.roles.filter((r) => r.trim()) : null,
    portfolioIds: query.portfolioIds?.length
      ? query.portfolioIds
          .slice(0, RESOURCE_GAP_MAX_PORTFOLIO_IDS)
          .filter((n) => Number.isFinite(n))
      : null,
    timeBucketGranularity:
      query.timeBucketGranularity === 'month'
        ? 'month'
        : query.timeBucketGranularity === 'day'
          ? 'day'
          : 'iso_week',
    topN: resourceGapClamp(query.topN ?? RESOURCE_GAP_DEFAULT_TOP_N, 1, RESOURCE_GAP_MAX_TOP_N),
    reasonTopN: resourceGapClamp(
      query.reasonTopN ?? RESOURCE_GAP_DEFAULT_REASON_TOP_N,
      1,
      RESOURCE_GAP_MAX_REASON_TOP_N,
    ),
    search: query.search?.trim().slice(0, 200) || null,
    sort: query.sort ?? 'severity',
    order: query.order === 'asc' ? 'asc' : 'desc',
    page: resourceGapClamp(query.page ?? RESOURCE_GAP_DEFAULT_PAGE, 1, 10_000),
    perPage: resourceGapClamp(
      query.perPage ?? RESOURCE_GAP_DEFAULT_PER_PAGE,
      1,
      RESOURCE_GAP_MAX_PER_PAGE,
    ),
  }
}

/** 获取验证详情（供 Validator 使用） */
export function resourceGapValidationDetail(): {
  allowedTypes: readonly ResourceGapQueryType[]
  allowedMetrics: readonly ResourceGapMetric[]
  allowedDimensions: readonly ResourceGapDimension[]
  allowedSeverities: readonly ResourceGapSeverity[]
  maxDateWindowDays: number
  maxPerPage: number
  maxTopN: number
  maxReasonTopN: number
  maxPortfolioIds: number
  maxSkillKeys: number
  maxProjectIds: number
} {
  return {
    allowedTypes: RESOURCE_GAP_QUERY_TYPE_VALUES,
    allowedMetrics: RESOURCE_GAP_METRIC_VALUES,
    allowedDimensions: RESOURCE_GAP_DIMENSION_VALUES,
    allowedSeverities: RESOURCE_GAP_SEVERITY_VALUES,
    maxDateWindowDays: RESOURCE_GAP_MAX_DATE_WINDOW_DAYS,
    maxPerPage: RESOURCE_GAP_MAX_PER_PAGE,
    maxTopN: RESOURCE_GAP_MAX_TOP_N,
    maxReasonTopN: RESOURCE_GAP_MAX_REASON_TOP_N,
    maxPortfolioIds: RESOURCE_GAP_MAX_PORTFOLIO_IDS,
    maxSkillKeys: RESOURCE_GAP_MAX_SKILL_KEYS,
    maxProjectIds: RESOURCE_GAP_MAX_PROJECT_IDS,
  }
}

/** 严重度标签中文映射 */
export const RESOURCE_GAP_SEVERITY_LABELS: Record<ResourceGapSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
}

/** 维度标签中文映射 */
export const RESOURCE_GAP_DIMENSION_LABELS: Record<ResourceGapDimension, string> = {
  role: '角色',
  skill: '技能',
  timeBucket: '时间桶',
  project: '项目',
  portfolio: '组合',
  organization: '组织',
}

/** 口径标签中文映射 */
export const RESOURCE_GAP_METRIC_LABELS: Record<ResourceGapMetric, string> = {
  allocated_vs_demand: '已分配 vs 需求',
  available_vs_demand: '可用 vs 需求',
  skill_shortfall: '技能缺口',
  forecast_gap: '预测缺口',
}

/** 生成规则模板解释文本 */
export function buildRuleExplanation(
  reasonCode: ResourceGapReasonCode,
  context: { dimensionLabel: string; dimensionValue: string; gapHours: number },
): string {
  const hours = resourceGapRoundTwo(context.gapHours)
  const label = RESOURCE_GAP_REASON_LABELS[reasonCode]
  const prefix = `【${label}】在${context.dimensionLabel}「${context.dimensionValue}」中`
  switch (reasonCode) {
    case 'NO_CANDIDATE_RESOURCE':
      return `${prefix}，组织中不存在具有所需技能的资源，缺口约 ${hours} 小时。建议考虑外部招聘或技能培训。`
    case 'CANDIDATES_OVERLOADED':
      return `${prefix}，所有候选资源当前已过载，无法承担额外 ${hours} 小时需求。建议重新分配负载或调整任务优先级。`
    case 'SKILL_ORG_WIDE_SHORTAGE':
      return `${prefix}，整个组织中此技能持有者不足，缺口约 ${hours} 小时。建议启动技能发展规划或跨组织协调。`
    case 'ALLOC_CONFLICT':
      return `${prefix}，候选资源在所需时间窗口内存在 ${hours} 小时的分配冲突。建议调整时间窗口或重新分配任务。`
    case 'PRIORITY_CROWDING':
      return `${prefix}，候选资源被更高优先级项目挤占，可用容量减少 ${hours} 小时。建议复核项目优先级或进行跨项目调配。`
    case 'AVAILABILITY_EXCEPTION':
      return `${prefix}，候选资源存在工作日历例外（休假/出差/兼职），可用容量减少 ${hours} 小时。建议调整时间安排或启用替代资源。`
    case 'FORECAST_UNCERTAIN':
      return `${prefix}，预测置信度过低导致缺口估计不确定（±${hours} 小时）。建议补充需求数据或缩短预测窗口。`
  }
}

/** 确定缺口严重度（基于 gapRatio） */
export function determineGapSeverity(gapRatio: number): ResourceGapSeverity {
  if (gapRatio >= 0.75) return 'critical'
  if (gapRatio >= 0.5) return 'high'
  if (gapRatio >= 0.25) return 'medium'
  if (gapRatio > 0) return 'low'
  return 'none'
}

/** 生成建议动作（基于原因码和缺口上下文） */
export function generateSuggestedActions(
  reasonCodes: ResourceGapReasonCode[],
  context: { dimension: ResourceGapDimension; gapHours: number; role?: string; skill?: string },
): ResourceGapSuggestedAction[] {
  const actions: ResourceGapSuggestedAction[] = []
  const codes = new Set(reasonCodes)

  if (codes.has('NO_CANDIDATE_RESOURCE') || codes.has('SKILL_ORG_WIDE_SHORTAGE')) {
    actions.push({
      actionType: 'hire',
      description: `招聘具备${context.skill ?? context.role ?? '相关技能'}的资源`,
      estimatedImpactHours: context.gapHours,
      targetRole: context.role ?? null,
      targetSkill: context.skill ?? null,
    })
    actions.push({
      actionType: 'skill_development',
      description: `对现有资源进行${context.skill ?? '相关'}技能培训`,
      estimatedImpactHours: resourceGapRoundTwo(context.gapHours * 0.5),
      targetRole: null,
      targetSkill: context.skill ?? null,
    })
  }

  if (codes.has('CANDIDATES_OVERLOADED') || codes.has('ALLOC_CONFLICT')) {
    actions.push({
      actionType: 'reallocate',
      description: '重新分配负载，将部分任务转移给可用资源',
      estimatedImpactHours: context.gapHours,
      targetRole: context.role ?? null,
      targetSkill: null,
    })
  }

  if (codes.has('PRIORITY_CROWDING')) {
    actions.push({
      actionType: 'reprioritize',
      description: '复核并调整项目优先级排序',
      estimatedImpactHours: null,
      targetRole: null,
      targetSkill: null,
    })
  }

  if (codes.has('AVAILABILITY_EXCEPTION')) {
    actions.push({
      actionType: 'reschedule',
      description: '调整任务时间窗口以避开可用性例外期间',
      estimatedImpactHours: context.gapHours,
      targetRole: null,
      targetSkill: null,
    })
  }

  if (codes.has('FORECAST_UNCERTAIN')) {
    actions.push({
      actionType: 'external_resource',
      description: '准备外部资源作为应急储备',
      estimatedImpactHours: null,
      targetRole: context.role ?? null,
      targetSkill: context.skill ?? null,
    })
  }

  return actions
}
