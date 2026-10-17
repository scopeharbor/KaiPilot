// @aiproj/types —— OKR Dashboard 共享契约（前后端共享）。
// v3-okr-dashboard §2：稳定 metric keys、warning codes、source kinds、query bounds、
// DTO、empty/restricted/stale states、drill-down targets 与确定性纯函数聚合助手。
//
// 红线：
//   - 只读投影，无副作用；不新增 OKR 事实、不触发 backflow 生成/确认、不改 KR 值。
//   - 所有查询由后端自动过滤 `organization_id`；drill-down target 由后端授权后下发。
//   - 权限受限维度只返回低敏 forbidden/unavailable 状态与 warning，不返回隐藏名称、
//     计数、值、证据文本、prompt、模型输出或未授权链接。
//   - 财务/预算/ROI/成本不在范围内。

import type {
  OkrAlignment,
  OkrConfidenceLevel,
  OkrEvidenceLink,
  OkrKeyResult,
  OkrObjective,
  OkrProgressHistory,
  OkrScope,
  OkrStatus,
} from './okr.js'
import { OKR_METRIC_VERSION, OKR_SCOPE_VALUES, OKR_STATUS_VALUES } from './okr.js'

// ─── Metric Keys ───────────────────────────────────────────────────────────────

export const OKR_DASHBOARD_METRIC_KEYS = {
  // 周期与规模
  TOTAL_OBJECTIVES: 'okr_total_objectives',
  ACTIVE_OBJECTIVES: 'okr_active_objectives',
  COMPLETED_OBJECTIVES: 'okr_completed_objectives',
  AT_RISK_OBJECTIVES: 'okr_at_risk_objectives',
  BEHIND_OBJECTIVES: 'okr_behind_objectives',

  // KR 维度
  TOTAL_KEY_RESULTS: 'okr_total_key_results',
  BEHIND_KEY_RESULTS: 'okr_behind_key_results',
  STALE_KEY_RESULTS: 'okr_stale_key_results',
  MISSING_EVIDENCE_KEY_RESULTS: 'okr_missing_evidence_key_results',

  // 综合达成
  OVERALL_PROGRESS_AVG: 'okr_overall_progress_avg',
  CONFIDENCE_AVG: 'okr_confidence_avg',

  // 对齐健康度
  ALIGNMENT_HEALTH_SCORE: 'okr_alignment_health_score',
  ORPHAN_OBJECTIVE_COUNT: 'okr_orphan_objective_count',
  WEAK_ALIGNMENT_COUNT: 'okr_weak_alignment_count',

  // 证据 / 新鲜度
  STALE_EVIDENCE_COUNT: 'okr_stale_evidence_count',
  RECENT_PROGRESS_COUNT: 'okr_recent_progress_count',

  // Backflow 概览（可选）
  BACKFLOW_CANDIDATE_COUNT: 'okr_backflow_candidate_count',
  BACKFLOW_CONFLICT_COUNT: 'okr_backflow_conflict_count',
} as const

export type OkrDashboardMetricKey =
  (typeof OKR_DASHBOARD_METRIC_KEYS)[keyof typeof OKR_DASHBOARD_METRIC_KEYS]

export const OKR_DASHBOARD_METRIC_KEY_VALUES = Object.values(
  OKR_DASHBOARD_METRIC_KEYS,
) as readonly OkrDashboardMetricKey[]

export type OkrDashboardMetricUnit = 'count' | 'percent' | 'score' | 'avg'

// ─── Source Kinds ──────────────────────────────────────────────────────────────

export const OKR_DASHBOARD_SOURCES = {
  CYCLE: 'okr_cycle',
  OBJECTIVE: 'okr_objective',
  KEY_RESULT: 'okr_key_result',
  ALIGNMENT: 'okr_alignment',
  EVIDENCE: 'okr_evidence',
  PROGRESS_HISTORY: 'okr_progress_history',
  BACKFLOW: 'okr_backflow',
  COMPUTED: 'computed',
} as const

export type OkrDashboardSource = (typeof OKR_DASHBOARD_SOURCES)[keyof typeof OKR_DASHBOARD_SOURCES]

export const OKR_DASHBOARD_SOURCE_VALUES = Object.values(
  OKR_DASHBOARD_SOURCES,
) as readonly OkrDashboardSource[]

// ─── Statuses ──────────────────────────────────────────────────────────────────

export const OKR_DASHBOARD_STATUSES = {
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  STALE: 'stale',
  UNSUPPORTED: 'unsupported',
} as const

export type OkrDashboardStatus =
  (typeof OKR_DASHBOARD_STATUSES)[keyof typeof OKR_DASHBOARD_STATUSES]

// ─── Warnings ──────────────────────────────────────────────────────────────────

export const OKR_DASHBOARD_WARNING_CODES = {
  EMPTY_OKR_DASHBOARD: 'EMPTY_OKR_DASHBOARD',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_PARTIAL: 'SOURCE_PARTIAL',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  BACKFLOW_SUMMARY_UNAVAILABLE: 'BACKFLOW_SUMMARY_UNAVAILABLE',
  BACKFLOW_SUMMARY_FORBIDDEN: 'BACKFLOW_SUMMARY_FORBIDDEN',
  RESTRICTED_EVIDENCE: 'RESTRICTED_EVIDENCE',
  ATTENTION_TRUNCATED: 'ATTENTION_TRUNCATED',
  ORPHAN_OBJECTIVE: 'ORPHAN_OBJECTIVE',
  WEAK_ALIGNMENT: 'WEAK_ALIGNMENT',
  DISABLED_SCOPE_REFERENCED: 'DISABLED_SCOPE_REFERENCED',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
} as const

export type OkrDashboardWarningCode =
  (typeof OKR_DASHBOARD_WARNING_CODES)[keyof typeof OKR_DASHBOARD_WARNING_CODES]

export const OKR_DASHBOARD_WARNING_CODE_VALUES = Object.values(
  OKR_DASHBOARD_WARNING_CODES,
) as readonly OkrDashboardWarningCode[]

export interface OkrDashboardWarning {
  code: OkrDashboardWarningCode
  message: string
  metricKey?: OkrDashboardMetricKey
  source?: OkrDashboardSource
}

// ─── Sections（查询白名单）────────────────────────────────────────────────────

export const OKR_DASHBOARD_SECTIONS = {
  CYCLE_CONTEXT: 'cycle_context',
  KPI: 'kpi',
  PROGRESS_DISTRIBUTION: 'progress_distribution',
  ATTENTION: 'attention',
  ALIGNMENT_HEALTH: 'alignment_health',
  EVIDENCE_FRESHNESS: 'evidence_freshness',
  BACKFLOW: 'backflow',
} as const

export type OkrDashboardSection =
  (typeof OKR_DASHBOARD_SECTIONS)[keyof typeof OKR_DASHBOARD_SECTIONS]

export const OKR_DASHBOARD_SECTION_VALUES = Object.values(
  OKR_DASHBOARD_SECTIONS,
) as readonly OkrDashboardSection[]

// ─── Include 白名单 ───────────────────────────────────────────────────────────

export const OKR_DASHBOARD_INCLUDES = {
  EVIDENCE_FRESHNESS: 'evidence_freshness',
  ALIGNMENT_HEALTH: 'alignment_health',
  BACKFLOW: 'backflow',
} as const

export type OkrDashboardInclude =
  (typeof OKR_DASHBOARD_INCLUDES)[keyof typeof OKR_DASHBOARD_INCLUDES]

export const OKR_DASHBOARD_INCLUDE_VALUES = Object.values(
  OKR_DASHBOARD_INCLUDES,
) as readonly OkrDashboardInclude[]

// ─── Attention Sort 白名单 ────────────────────────────────────────────────────

export const OKR_DASHBOARD_ATTENTION_SORT_KEYS = {
  RISK_SCORE: 'risk_score',
  PROGRESS: 'progress',
  CONFIDENCE: 'confidence',
  UPDATED_AT: 'updated_at',
  TITLE: 'title',
} as const

export type OkrDashboardAttentionSortKey =
  (typeof OKR_DASHBOARD_ATTENTION_SORT_KEYS)[keyof typeof OKR_DASHBOARD_ATTENTION_SORT_KEYS]

export const OKR_DASHBOARD_ATTENTION_SORT_KEY_VALUES = Object.values(
  OKR_DASHBOARD_ATTENTION_SORT_KEYS,
) as readonly OkrDashboardAttentionSortKey[]

// ─── Attention 原因 ──────────────────────────────────────────────────────────

export const OKR_DASHBOARD_ATTENTION_REASONS = {
  BEHIND_TARGET: 'behind_target',
  STALE_EVIDENCE: 'stale_evidence',
  MISSING_KEY_RESULTS: 'missing_key_results',
  WEAK_ALIGNMENT: 'weak_alignment',
  BLOCKED_PROGRESS: 'blocked_progress',
  LOW_CONFIDENCE: 'low_confidence',
  BACKFLOW_UNAVAILABLE: 'backflow_unavailable',
} as const

export type OkrDashboardAttentionReason =
  (typeof OKR_DASHBOARD_ATTENTION_REASONS)[keyof typeof OKR_DASHBOARD_ATTENTION_REASONS]

export const OKR_DASHBOARD_ATTENTION_REASON_VALUES = Object.values(
  OKR_DASHBOARD_ATTENTION_REASONS,
) as readonly OkrDashboardAttentionReason[]

// ─── 常量 ──────────────────────────────────────────────────────────────────────

export const OKR_DASHBOARD_METRIC_VERSION = `okr-dashboard.${OKR_METRIC_VERSION}` as const

export const OKR_DASHBOARD_DEFAULT_ATTENTION_LIMIT = 8
export const OKR_DASHBOARD_MAX_ATTENTION_LIMIT = 50
export const OKR_DASHBOARD_DEFAULT_STALE_MINUTES = 60 * 24 * 3 // 3 天
export const OKR_DASHBOARD_MAX_STALE_MINUTES = 60 * 24 * 30 // 30 天
export const OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS = 180
export const OKR_DASHBOARD_MAX_SEARCH_LENGTH = 200
/** 单次聚合允许扫描的 objective 上限——超过时按 attention 采样并返回 SOURCE_PARTIAL。 */
export const OKR_DASHBOARD_MAX_SCAN_OBJECTIVES = 5000
/** KR 落后阈值——进度低于目标周期百分比减去该差值时归为 BEHIND。 */
export const OKR_DASHBOARD_BEHIND_MARGIN_PERCENT = 15

// ─── Drill-down Target ─────────────────────────────────────────────────────────

export const OKR_DASHBOARD_TARGET_KINDS = {
  OBJECTIVE: 'objective',
  KEY_RESULT: 'key_result',
  CYCLE: 'cycle',
  EVIDENCE: 'evidence',
  PROGRESS_HISTORY: 'progress_history',
  ALIGNMENT: 'alignment',
  BACKFLOW: 'backflow',
} as const

export type OkrDashboardTargetKind =
  (typeof OKR_DASHBOARD_TARGET_KINDS)[keyof typeof OKR_DASHBOARD_TARGET_KINDS]

/** 低敏 route descriptor：只描述「去哪里」，不含实体名称、证据文本或未授权字段。 */
export interface OkrDashboardTarget {
  kind: OkrDashboardTargetKind
  href: string
  authorized: boolean
}

// ─── Freshness ─────────────────────────────────────────────────────────────────

export interface OkrDashboardSourceFreshness {
  source: OkrDashboardSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
  status: OkrDashboardStatus
}

// ─── Metric ────────────────────────────────────────────────────────────────────

export interface OkrDashboardMetric {
  key: OkrDashboardMetricKey
  value: number | null
  unit: OkrDashboardMetricUnit
  source: OkrDashboardSource
  status: OkrDashboardStatus
  warnings?: OkrDashboardWarning[]
}

// ─── 分布切片 ─────────────────────────────────────────────────────────────────

export interface OkrDashboardDistributionSlice {
  key: string
  label: string
  count: number
  percent: number
}

// ─── 周期上下文 ───────────────────────────────────────────────────────────────

export interface OkrDashboardCycleContext {
  cycleId: number | null
  title: string | null
  status: OkrStatus | null
  startDate: string | null
  endDate: string | null
  /** 从 startDate 到今天占整个周期长度的百分比 [0,100]；无 cycle 时为 null。 */
  elapsedPercent: number | null
  daysRemaining: number | null
}

// ─── Attention Item ───────────────────────────────────────────────────────────

export interface OkrDashboardAttentionItem {
  kind: 'objective' | 'key_result'
  entityId: number
  title: string
  scope: OkrScope | null
  status: OkrStatus
  progress: number
  confidence: OkrConfidenceLevel
  ownerId: number | null
  riskScore: number
  reasons: OkrDashboardAttentionReason[]
  freshness: OkrDashboardSourceFreshness | null
  target: OkrDashboardTarget | null
  warnings: OkrDashboardWarning[]
}

// ─── Alignment Health ─────────────────────────────────────────────────────────

export interface OkrDashboardAlignmentHealth {
  available: boolean
  forbidden: boolean
  healthScore: number | null
  orphanObjectiveCount: number | null
  weakAlignmentCount: number | null
  disabledScopeReferences: number | null
  maxDepth: number | null
  warnings: OkrDashboardWarning[]
}

// ─── Evidence Freshness ──────────────────────────────────────────────────────

export interface OkrDashboardEvidenceFreshness {
  available: boolean
  forbidden: boolean
  totalEvidence: number | null
  staleEvidence: number | null
  restrictedEvidence: number | null
  freshestAt: string | null
  stalestAt: string | null
  warnings: OkrDashboardWarning[]
}

// ─── Backflow Summary（只读，可选源）─────────────────────────────────────────

export interface OkrDashboardBackflowSummary {
  available: boolean
  forbidden: boolean
  candidateCount: number | null
  conflictCount: number | null
  staleCount: number | null
  lastRefreshedAt: string | null
  targets: OkrDashboardTarget[]
  warnings: OkrDashboardWarning[]
}

// ─── Meta 与 Summary ─────────────────────────────────────────────────────────

export interface OkrDashboardMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  cycleId: number | null
  visibleObjectiveCount: number
  visibleKeyResultCount: number
  restrictedObjectiveCount: number
  restrictedKeyResultCount: number
  sections: OkrDashboardSection[]
  attentionLimit: number
  staleThresholdMinutes: number
  inputSignatureHash: string
}

export interface OkrDashboardSummary {
  meta: OkrDashboardMeta
  cycleContext: OkrDashboardCycleContext
  kpis: OkrDashboardMetric[]
  progressDistribution: OkrDashboardDistributionSlice[]
  statusDistribution: OkrDashboardDistributionSlice[]
  attention: OkrDashboardAttentionItem[]
  alignmentHealth: OkrDashboardAlignmentHealth
  evidenceFreshness: OkrDashboardEvidenceFreshness
  backflow: OkrDashboardBackflowSummary
  sourceFreshness: OkrDashboardSourceFreshness[]
  warnings: OkrDashboardWarning[]
}

// ─── Query ────────────────────────────────────────────────────────────────────

export interface OkrDashboardQuery {
  cycleId?: number
  scope?: OkrScope | OkrScope[]
  ownerId?: number
  status?: OkrStatus | OkrStatus[]
  sections?: OkrDashboardSection[]
  include?: OkrDashboardInclude[]
  attentionLimit?: number
  attentionSort?: OkrDashboardAttentionSortKey
  attentionOrder?: 'asc' | 'desc'
  staleThresholdMinutes?: number
  dateFrom?: string
  dateTo?: string
  search?: string
}

export interface NormalizedOkrDashboardQuery {
  cycleId?: number
  scopes?: OkrScope[]
  ownerId?: number
  statuses?: OkrStatus[]
  sections: OkrDashboardSection[]
  includes: OkrDashboardInclude[]
  attentionLimit: number
  attentionSort: OkrDashboardAttentionSortKey
  attentionOrder: 'asc' | 'desc'
  staleThresholdMinutes: number
  dateFrom?: string
  dateTo?: string
  search?: string
}

export interface OkrDashboardValidationDetail {
  allowedSections: readonly OkrDashboardSection[]
  allowedIncludes: readonly OkrDashboardInclude[]
  allowedAttentionSorts: readonly OkrDashboardAttentionSortKey[]
  allowedScopes: readonly OkrScope[]
  allowedStatuses: readonly OkrStatus[]
  maxAttentionLimit: number
  maxStaleThresholdMinutes: number
  maxDateWindowDays: number
  maxSearchLength: number
}

// ─── API Envelope ─────────────────────────────────────────────────────────────

export interface OkrDashboardSummaryResponse {
  data: OkrDashboardSummary
}

// ─── 低敏 Read Audit（可选） ─────────────────────────────────────────────────

export interface OkrDashboardReadAudit {
  actorId: number
  organizationId: number
  cycleId: number | null
  sections: OkrDashboardSection[]
  metricKeys: OkrDashboardMetricKey[]
  sourceFreshnessHashes: Array<{ source: OkrDashboardSource; hash: string }>
  querySignatureHash: string
  occurredAt: string
}

// ─── 组织 Dashboard OKR 模块渲染 adapter（v3-okr-dashboard §4.5） ─────────────

/**
 * 组织 Dashboard OKR 摘要模块渲染 props。
 *
 * 目的：让组织 Dashboard layout 模块直接消费 OKR Dashboard summary，
 * 不新建查询、公式或数据源；模块只做"取摘要 → 投影几个 KPI + 关注项前 N 项"。
 * 保证组织 Dashboard 的自有指标语义（项目/成员/风险）不因此发生变化。
 *
 * 红线：
 *   - 只读投影；不复制证据正文、prompt、模型输出、Authorization。
 *   - 若 summary 不可用（forbidden / stale / unavailable），只返回 emptyStateKey + reasonCode。
 *   - attention 只保留低敏字段（title 与 reasonCode 已在 summary 层脱敏）。
 */
export interface OkrDashboardModuleRenderProps {
  status: OkrDashboardStatus
  reasonCode: 'ok' | 'empty' | 'forbidden' | 'unavailable' | 'stale'
  emptyStateKey: string | null
  metricVersion: string
  cycleTitle: string | null
  cycleStatus: OkrStatus | null
  kpis: Array<{
    key: OkrDashboardMetricKey
    value: number
    unit: OkrDashboardMetricUnit
    status: OkrDashboardStatus
  }>
  attentionTop: OkrDashboardAttentionItem[]
  warningCodes: OkrDashboardWarningCode[]
  navigationTarget: { type: 'okr_dashboard'; organizationId: number }
}

export const OKR_DASHBOARD_MODULE_KPI_KEYS: readonly OkrDashboardMetricKey[] = [
  OKR_DASHBOARD_METRIC_KEYS.ACTIVE_OBJECTIVES,
  OKR_DASHBOARD_METRIC_KEYS.AT_RISK_OBJECTIVES,
  OKR_DASHBOARD_METRIC_KEYS.BEHIND_KEY_RESULTS,
  OKR_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
]

export interface BuildOkrDashboardModuleRenderPropsInput {
  summary: OkrDashboardSummary | null
  actorCanView: boolean
  moduleEmptyStateKey: string
  attentionLimit?: number
}

/**
 * 从 OKR Dashboard summary 生成组织 Dashboard 模块渲染 props。
 * 纯函数——不查库、不发请求、不写入。
 */
export function buildOkrDashboardModuleRenderProps(
  input: BuildOkrDashboardModuleRenderPropsInput,
): OkrDashboardModuleRenderProps {
  const { summary, actorCanView, moduleEmptyStateKey } = input
  const attentionLimit = clamp(input.attentionLimit ?? 3, 1, 10)

  // 无 summary：可能是权限拒绝、能力关闭或还未加载
  if (!summary) {
    return {
      status: OKR_DASHBOARD_STATUSES.UNAVAILABLE,
      reasonCode: actorCanView ? 'unavailable' : 'forbidden',
      emptyStateKey: moduleEmptyStateKey,
      metricVersion: OKR_DASHBOARD_METRIC_VERSION,
      cycleTitle: null,
      cycleStatus: null,
      kpis: [],
      attentionTop: [],
      warningCodes: [],
      navigationTarget: { type: 'okr_dashboard', organizationId: 0 },
    }
  }

  const restrictedByCycle = summary.cycleContext.cycleId === null
  const empty = summary.meta.visibleObjectiveCount === 0 && summary.meta.visibleKeyResultCount === 0
  const stale = summary.warnings.some((w) => w.code === OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE)

  // 反投影 KPI：只挑选 OKR_DASHBOARD_MODULE_KPI_KEYS 白名单里的指标
  const filteredKpis = summary.kpis
    .filter((k) => OKR_DASHBOARD_MODULE_KPI_KEYS.includes(k.key))
    .map((k) => ({
      key: k.key,
      value: typeof k.value === 'number' ? k.value : 0,
      unit: k.unit,
      status: k.status,
    }))

  const reasonCode: OkrDashboardModuleRenderProps['reasonCode'] = empty
    ? 'empty'
    : stale
      ? 'stale'
      : 'ok'

  return {
    status: empty
      ? OKR_DASHBOARD_STATUSES.EMPTY
      : stale
        ? OKR_DASHBOARD_STATUSES.STALE
        : OKR_DASHBOARD_STATUSES.OK,
    reasonCode,
    emptyStateKey: empty || restrictedByCycle ? moduleEmptyStateKey : null,
    metricVersion: summary.meta.metricVersion,
    cycleTitle: summary.cycleContext.title,
    cycleStatus: summary.cycleContext.status,
    kpis: filteredKpis,
    attentionTop: summary.attention.slice(0, attentionLimit),
    warningCodes: summary.warnings.map((w) => w.code),
    navigationTarget: {
      type: 'okr_dashboard',
      organizationId: summary.meta.organizationId,
    },
  }
}

// ─── 纯函数助手 ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function coerceArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** 稳定 FNV-1a 哈希——input signature 与 freshness 指纹用。 */
export function okrDashboardStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 归一化查询：section/include 白名单 + limit clamp + search 截断。 */
export function normalizeOkrDashboardQuery(
  query: OkrDashboardQuery = {},
): NormalizedOkrDashboardQuery {
  const requestedSections = query.sections?.filter((section) =>
    OKR_DASHBOARD_SECTION_VALUES.includes(section),
  )
  const sections =
    requestedSections && requestedSections.length > 0
      ? OKR_DASHBOARD_SECTION_VALUES.filter((section) => requestedSections.includes(section))
      : [...OKR_DASHBOARD_SECTION_VALUES]

  const requestedIncludes = query.include?.filter((include) =>
    OKR_DASHBOARD_INCLUDE_VALUES.includes(include),
  )
  const includes =
    requestedIncludes && requestedIncludes.length > 0
      ? OKR_DASHBOARD_INCLUDE_VALUES.filter((include) => requestedIncludes.includes(include))
      : [...OKR_DASHBOARD_INCLUDE_VALUES]

  const scopeCandidates = coerceArray(query.scope).filter((scope) =>
    OKR_SCOPE_VALUES.includes(scope),
  )
  const statusCandidates = coerceArray(query.status).filter((status) =>
    OKR_STATUS_VALUES.includes(status),
  )

  const search = query.search?.trim().slice(0, OKR_DASHBOARD_MAX_SEARCH_LENGTH)

  return {
    cycleId:
      typeof query.cycleId === 'number' && Number.isFinite(query.cycleId)
        ? Math.trunc(query.cycleId)
        : undefined,
    scopes: scopeCandidates.length > 0 ? [...new Set(scopeCandidates)] : undefined,
    ownerId:
      typeof query.ownerId === 'number' && Number.isFinite(query.ownerId)
        ? Math.trunc(query.ownerId)
        : undefined,
    statuses: statusCandidates.length > 0 ? [...new Set(statusCandidates)] : undefined,
    sections,
    includes,
    attentionLimit: clamp(
      query.attentionLimit ?? OKR_DASHBOARD_DEFAULT_ATTENTION_LIMIT,
      1,
      OKR_DASHBOARD_MAX_ATTENTION_LIMIT,
    ),
    attentionSort: query.attentionSort ?? OKR_DASHBOARD_ATTENTION_SORT_KEYS.RISK_SCORE,
    attentionOrder: query.attentionOrder === 'asc' ? 'asc' : 'desc',
    staleThresholdMinutes: clamp(
      query.staleThresholdMinutes ?? OKR_DASHBOARD_DEFAULT_STALE_MINUTES,
      1,
      OKR_DASHBOARD_MAX_STALE_MINUTES,
    ),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    search: search ? search : undefined,
  }
}

/** 校验失败时返回给前端的低敏允许值清单。 */
export function okrDashboardValidationDetail(): OkrDashboardValidationDetail {
  return {
    allowedSections: OKR_DASHBOARD_SECTION_VALUES,
    allowedIncludes: OKR_DASHBOARD_INCLUDE_VALUES,
    allowedAttentionSorts: OKR_DASHBOARD_ATTENTION_SORT_KEY_VALUES,
    allowedScopes: OKR_SCOPE_VALUES,
    allowedStatuses: OKR_STATUS_VALUES,
    maxAttentionLimit: OKR_DASHBOARD_MAX_ATTENTION_LIMIT,
    maxStaleThresholdMinutes: OKR_DASHBOARD_MAX_STALE_MINUTES,
    maxDateWindowDays: OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS,
    maxSearchLength: OKR_DASHBOARD_MAX_SEARCH_LENGTH,
  }
}

/** 判定来源是否过期。`null` 视为过期。 */
export function isOkrDashboardSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number = OKR_DASHBOARD_DEFAULT_STALE_MINUTES,
  now: number = Date.now(),
): boolean {
  if (!lastUpdatedAt) return true
  const last = new Date(lastUpdatedAt).getTime()
  if (!Number.isFinite(last)) return true
  return now - last > thresholdMinutes * 60 * 1000
}

/** 构造 OKR Dashboard freshness 条目。 */
export function makeOkrDashboardFreshness(input: {
  source: OkrDashboardSource
  lastUpdatedAt: string | null
  staleThresholdMinutes?: number
  forbidden?: boolean
  unavailable?: boolean
  now?: number
}): OkrDashboardSourceFreshness {
  const staleThresholdMinutes = input.staleThresholdMinutes ?? OKR_DASHBOARD_DEFAULT_STALE_MINUTES
  if (input.forbidden) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: OKR_DASHBOARD_STATUSES.FORBIDDEN,
    }
  }
  if (input.unavailable) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: OKR_DASHBOARD_STATUSES.UNAVAILABLE,
    }
  }
  const isStale = isOkrDashboardSourceStale(input.lastUpdatedAt, staleThresholdMinutes, input.now)
  return {
    source: input.source,
    lastUpdatedAt: input.lastUpdatedAt,
    isStale,
    staleThresholdMinutes,
    status: isStale ? OKR_DASHBOARD_STATUSES.STALE : OKR_DASHBOARD_STATUSES.OK,
  }
}

/** freshness 指纹——审计用，不含业务事实。 */
export function okrDashboardFreshnessHash(freshness: OkrDashboardSourceFreshness): string {
  return okrDashboardStableHash(
    `${freshness.source}:${freshness.lastUpdatedAt ?? 'none'}:${freshness.status}`,
  )
}

// ─── Warning 工厂 ─────────────────────────────────────────────────────────────

export function emptyOkrDashboardWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.EMPTY_OKR_DASHBOARD,
    message: '当前组织没有可见的 OKR 周期或目标，指标为空而非缺失',
  }
}

export function okrDashboardPermissionRedactedWarning(
  source: OkrDashboardSource,
  metricKey?: OkrDashboardMetricKey,
): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED,
    message: `来源 ${source} 因权限不足已脱敏`,
    source,
    ...(metricKey ? { metricKey } : {}),
  }
}

export function okrDashboardSourceStaleWarning(source: OkrDashboardSource): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE,
    message: `来源 ${source} 数据已超过新鲜度阈值`,
    source,
  }
}

export function okrDashboardSourcePartialWarning(source: OkrDashboardSource): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.SOURCE_PARTIAL,
    message: `来源 ${source} 仅返回采样结果，聚合为部分数据`,
    source,
  }
}

export function okrDashboardSourceUnavailableWarning(
  source: OkrDashboardSource,
): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.SOURCE_UNAVAILABLE,
    message: `来源 ${source} 当前不可用`,
    source,
  }
}

export function okrDashboardBackflowUnavailableWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.BACKFLOW_SUMMARY_UNAVAILABLE,
    message: 'OKR Progress Backflow 摘要来源不可用、未启用或尚未实现',
    source: OKR_DASHBOARD_SOURCES.BACKFLOW,
  }
}

export function okrDashboardBackflowForbiddenWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.BACKFLOW_SUMMARY_FORBIDDEN,
    message: '当前用户无 Backflow 摘要查看权限',
    source: OKR_DASHBOARD_SOURCES.BACKFLOW,
  }
}

export function okrDashboardRestrictedEvidenceWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.RESTRICTED_EVIDENCE,
    message: '部分证据因权限限制已脱敏，隐藏名称/正文/target',
    source: OKR_DASHBOARD_SOURCES.EVIDENCE,
  }
}

export function okrDashboardAttentionTruncatedWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.ATTENTION_TRUNCATED,
    message: '关注项超出上限，仅返回前 N 条，稳定排序保证结果一致',
  }
}

export function okrDashboardOrphanObjectiveWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.ORPHAN_OBJECTIVE,
    message: '存在无有效父级对齐的团队/项目 objective',
    source: OKR_DASHBOARD_SOURCES.ALIGNMENT,
  }
}

export function okrDashboardWeakAlignmentWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.WEAK_ALIGNMENT,
    message: '存在跨周期或父级已归档的弱对齐',
    source: OKR_DASHBOARD_SOURCES.ALIGNMENT,
  }
}

export function okrDashboardDisabledScopeWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.DISABLED_SCOPE_REFERENCED,
    message: '存在被禁用 scope 的 objective 引用，已从活跃聚合中排除',
    source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
  }
}

export function okrDashboardCacheDegradedWarning(): OkrDashboardWarning {
  return {
    code: OKR_DASHBOARD_WARNING_CODES.CACHE_DEGRADED,
    message: '可选摘要缓存不可用，已直接读取有界授权数据',
  }
}

/** 合并 warning 并按 code+source+metricKey 去重，保持稳定顺序。 */
export function mergeOkrDashboardWarnings(
  ...groups: Array<OkrDashboardWarning[] | undefined>
): OkrDashboardWarning[] {
  const seen = new Set<string>()
  const merged: OkrDashboardWarning[] = []
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = `${warning.code}|${warning.source ?? ''}|${warning.metricKey ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(warning)
    }
  }
  return merged
}

// ─── 脱敏投影 ─────────────────────────────────────────────────────────────────

export function redactedOkrDashboardMetric(
  key: OkrDashboardMetricKey,
  source: OkrDashboardSource,
  unit: OkrDashboardMetricUnit = 'count',
): OkrDashboardMetric {
  return {
    key,
    value: null,
    unit,
    source,
    status: OKR_DASHBOARD_STATUSES.FORBIDDEN,
    warnings: [okrDashboardPermissionRedactedWarning(source, key)],
  }
}

export function emptyOkrDashboardMetric(
  key: OkrDashboardMetricKey,
  source: OkrDashboardSource,
  unit: OkrDashboardMetricUnit = 'count',
): OkrDashboardMetric {
  return {
    key,
    value: 0,
    unit,
    source,
    status: OKR_DASHBOARD_STATUSES.EMPTY,
  }
}

// ─── 确定性聚合助手 ──────────────────────────────────────────────────────────

/**
 * OKR Dashboard 聚合助手输入。
 *
 * 输入必须已经过后端组织隔离与 RBAC 过滤：
 *  - `objectives` / `keyResults` 只含 actor 可见项，`restrictedObjectiveIds` / `restrictedKeyResultIds`
 *    列出因权限脱敏而排除的 ID（Dashboard 只用来计 restricted 计数与 warning，不返回真实 id）。
 *  - `evidence` / `progressHistory` 也应仅含 actor 可见项。
 *  - `backflow` 为可选摘要，未启用/未授权时可传 undefined 或 `{ unavailable: true }`。
 */
export interface ComputeOkrDashboardSummaryInput {
  organizationId: number
  actorId: number
  now?: number
  cycle: {
    cycleId: number | null
    title: string | null
    status: OkrStatus | null
    startDate: string | null
    endDate: string | null
  }
  objectives: OkrObjective[]
  keyResults: OkrKeyResult[]
  alignments: OkrAlignment[]
  evidence: OkrEvidenceLink[]
  progressHistory: OkrProgressHistory[]
  restrictedObjectiveCount?: number
  restrictedKeyResultCount?: number
  restrictedEvidenceCount?: number
  freshness?: {
    cycle?: string | null
    objective?: string | null
    keyResult?: string | null
    alignment?: string | null
    evidence?: string | null
    progressHistory?: string | null
    backflow?: string | null
  }
  backflow?: {
    available?: boolean
    forbidden?: boolean
    unavailable?: boolean
    candidateCount?: number
    conflictCount?: number
    staleCount?: number
    lastRefreshedAt?: string | null
    targets?: OkrDashboardTarget[]
  }
  normalizedQuery: NormalizedOkrDashboardQuery
  environmentWarnings?: OkrDashboardWarning[]
}

/** 内部：把 KR 的当前值折算成 0~100 的进度。 */
function computeKrProgressPercent(kr: OkrKeyResult): number {
  if (kr.targetValue === kr.baselineValue) return 0
  const raw = ((kr.currentValue - kr.baselineValue) / (kr.targetValue - kr.baselineValue)) * 100
  return Math.max(0, Math.min(100, Math.round(raw)))
}

/** 内部：判断 KR 是否落后于周期进度。 */
function isKrBehind(
  kr: OkrKeyResult,
  elapsedPercent: number | null,
  now: number,
  staleMinutes: number,
): { behind: boolean; stale: boolean } {
  const progress = computeKrProgressPercent(kr)
  const behind =
    elapsedPercent !== null && progress + OKR_DASHBOARD_BEHIND_MARGIN_PERCENT < elapsedPercent
  const stale = kr.lastUpdatedAt
    ? now - new Date(kr.lastUpdatedAt).getTime() > staleMinutes * 60 * 1000
    : true
  return { behind, stale }
}

/** 内部：为周期计算 elapsedPercent 与 daysRemaining。 */
function computeCycleElapsed(
  startDate: string | null,
  endDate: string | null,
  now: number,
): { elapsedPercent: number | null; daysRemaining: number | null } {
  if (!startDate || !endDate) return { elapsedPercent: null, daysRemaining: null }
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { elapsedPercent: null, daysRemaining: null }
  }
  const elapsedRatio = (now - start) / (end - start)
  const elapsedPercent = Math.max(0, Math.min(100, Math.round(elapsedRatio * 100)))
  const daysRemaining = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)))
  return { elapsedPercent, daysRemaining }
}

/** 内部：给 attention item 计算综合风险分（0~100，高的更需要关注）。 */
function computeAttentionRiskScore(input: {
  progress: number
  elapsedPercent: number | null
  confidence: OkrConfidenceLevel
  stale: boolean
  behind: boolean
}): number {
  let score = 0
  if (input.behind) score += 40
  if (input.stale) score += 20
  if (input.confidence === 'low') score += 25
  else if (input.confidence === 'medium') score += 10
  if (input.elapsedPercent !== null) {
    const gap = input.elapsedPercent - input.progress
    if (gap > 0) score += Math.min(20, Math.round(gap / 2))
  }
  return Math.max(0, Math.min(100, score))
}

/**
 * 确定性 OKR Dashboard 聚合助手。
 *
 * 输入的 objectives/keyResults 必须已经过组织隔离与 RBAC 过滤；本函数不做权限判定，
 * 只根据传入的 restricted 计数与 warning 生成脱敏 metadata。
 */
export function computeOkrDashboardSummary(
  input: ComputeOkrDashboardSummaryInput,
): OkrDashboardSummary {
  const now = input.now ?? Date.now()
  const nowIso = new Date(now).toISOString()
  const normalized = input.normalizedQuery
  const warnings: OkrDashboardWarning[] = []
  if (input.environmentWarnings) warnings.push(...input.environmentWarnings)

  const restrictedObjectiveCount = input.restrictedObjectiveCount ?? 0
  const restrictedKeyResultCount = input.restrictedKeyResultCount ?? 0
  const restrictedEvidenceCount = input.restrictedEvidenceCount ?? 0

  const visibleObjectives = input.objectives.filter((o) => o.deletedAt === null)
  const visibleKeyResults = input.keyResults.filter((kr) => kr.deletedAt === null)
  const visibleAlignments = input.alignments.filter((a) => a.deletedAt === null)
  const visibleEvidence = input.evidence.filter((e) => e.deletedAt === null)

  const isEmpty =
    visibleObjectives.length === 0 &&
    visibleKeyResults.length === 0 &&
    restrictedObjectiveCount === 0 &&
    restrictedKeyResultCount === 0

  if (isEmpty) warnings.push(emptyOkrDashboardWarning())

  // 周期上下文
  const { elapsedPercent, daysRemaining } = computeCycleElapsed(
    input.cycle.startDate,
    input.cycle.endDate,
    now,
  )
  const cycleContext: OkrDashboardCycleContext = {
    cycleId: input.cycle.cycleId,
    title: input.cycle.title,
    status: input.cycle.status,
    startDate: input.cycle.startDate,
    endDate: input.cycle.endDate,
    elapsedPercent,
    daysRemaining,
  }

  // KPI
  const activeObjectives = visibleObjectives.filter((o) =>
    ['active', 'draft', 'paused'].includes(o.status),
  )
  const completedObjectives = visibleObjectives.filter((o) => o.status === 'completed')
  const atRiskObjectives = visibleObjectives.filter(
    (o) => o.confidence === 'low' && o.status !== 'archived' && o.status !== 'completed',
  )
  const behindObjectives = visibleObjectives.filter((o) => {
    if (elapsedPercent === null) return false
    return o.progress + OKR_DASHBOARD_BEHIND_MARGIN_PERCENT < elapsedPercent
  })

  const staleMinutes = normalized.staleThresholdMinutes
  const krFlags = visibleKeyResults.map((kr) => ({
    kr,
    ...isKrBehind(kr, elapsedPercent, now, staleMinutes),
  }))
  const behindKeyResults = krFlags.filter((f) => f.behind)
  const staleKeyResults = krFlags.filter((f) => f.stale)

  // 缺失证据的 KR：actor 可见 KR ∩ 没有可见证据
  const evidenceByKrId = new Map<number, OkrEvidenceLink[]>()
  for (const e of visibleEvidence) {
    if (e.targetType === 'key_result') {
      const list = evidenceByKrId.get(e.targetId) ?? []
      list.push(e)
      evidenceByKrId.set(e.targetId, list)
    }
  }
  const missingEvidenceKrs = visibleKeyResults.filter(
    (kr) => (evidenceByKrId.get(kr.id) ?? []).length === 0,
  )

  const overallProgressAvg =
    visibleObjectives.length === 0
      ? 0
      : Math.round(
          visibleObjectives.reduce((sum, o) => sum + o.progress, 0) / visibleObjectives.length,
        )

  const confidenceScoreMap: Record<OkrConfidenceLevel, number> = { low: 20, medium: 60, high: 100 }
  const confidenceAvg =
    visibleObjectives.length === 0
      ? 0
      : Math.round(
          visibleObjectives.reduce((sum, o) => sum + confidenceScoreMap[o.confidence], 0) /
            visibleObjectives.length,
        )

  const kpis: OkrDashboardMetric[] = [
    {
      key: OKR_DASHBOARD_METRIC_KEYS.TOTAL_OBJECTIVES,
      value: visibleObjectives.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      status: isEmpty ? OKR_DASHBOARD_STATUSES.EMPTY : OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.ACTIVE_OBJECTIVES,
      value: activeObjectives.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.COMPLETED_OBJECTIVES,
      value: completedObjectives.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.AT_RISK_OBJECTIVES,
      value: atRiskObjectives.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.BEHIND_OBJECTIVES,
      value: behindObjectives.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.TOTAL_KEY_RESULTS,
      value: visibleKeyResults.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.KEY_RESULT,
      status: isEmpty ? OKR_DASHBOARD_STATUSES.EMPTY : OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.BEHIND_KEY_RESULTS,
      value: behindKeyResults.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.KEY_RESULT,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.STALE_KEY_RESULTS,
      value: staleKeyResults.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.KEY_RESULT,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.MISSING_EVIDENCE_KEY_RESULTS,
      value: missingEvidenceKrs.length,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.EVIDENCE,
      status: OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
      value: overallProgressAvg,
      unit: 'percent',
      source: OKR_DASHBOARD_SOURCES.COMPUTED,
      status: isEmpty ? OKR_DASHBOARD_STATUSES.EMPTY : OKR_DASHBOARD_STATUSES.OK,
    },
    {
      key: OKR_DASHBOARD_METRIC_KEYS.CONFIDENCE_AVG,
      value: confidenceAvg,
      unit: 'score',
      source: OKR_DASHBOARD_SOURCES.COMPUTED,
      status: isEmpty ? OKR_DASHBOARD_STATUSES.EMPTY : OKR_DASHBOARD_STATUSES.OK,
    },
  ]

  // 分布
  const total = visibleObjectives.length
  function slice(key: string, label: string, count: number): OkrDashboardDistributionSlice {
    return {
      key,
      label,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    }
  }
  const statusDistribution: OkrDashboardDistributionSlice[] = [
    slice('draft', '草稿', visibleObjectives.filter((o) => o.status === 'draft').length),
    slice('active', '进行中', visibleObjectives.filter((o) => o.status === 'active').length),
    slice('paused', '暂停', visibleObjectives.filter((o) => o.status === 'paused').length),
    slice('completed', '已完成', completedObjectives.length),
    slice('archived', '已归档', visibleObjectives.filter((o) => o.status === 'archived').length),
  ]
  const progressBuckets = [
    { key: 'lt25', label: '<25%', min: 0, max: 24 },
    { key: 'lt50', label: '25-49%', min: 25, max: 49 },
    { key: 'lt75', label: '50-74%', min: 50, max: 74 },
    { key: 'lt100', label: '75-99%', min: 75, max: 99 },
    { key: 'done', label: '100%', min: 100, max: 100 },
  ]
  const progressDistribution: OkrDashboardDistributionSlice[] = progressBuckets.map((b) => {
    const count = visibleObjectives.filter((o) => o.progress >= b.min && o.progress <= b.max).length
    return slice(b.key, b.label, count)
  })

  // Attention
  const attentionCandidates: OkrDashboardAttentionItem[] = []
  for (const { kr, behind, stale } of krFlags) {
    if (!behind && !stale && kr.confidence !== 'low') continue
    const reasons: OkrDashboardAttentionReason[] = []
    if (behind) reasons.push(OKR_DASHBOARD_ATTENTION_REASONS.BEHIND_TARGET)
    if (stale) reasons.push(OKR_DASHBOARD_ATTENTION_REASONS.STALE_EVIDENCE)
    if (kr.confidence === 'low') reasons.push(OKR_DASHBOARD_ATTENTION_REASONS.LOW_CONFIDENCE)
    if ((evidenceByKrId.get(kr.id) ?? []).length === 0)
      reasons.push(OKR_DASHBOARD_ATTENTION_REASONS.BLOCKED_PROGRESS)
    const progress = computeKrProgressPercent(kr)
    attentionCandidates.push({
      kind: 'key_result',
      entityId: kr.id,
      title: kr.title,
      scope: null,
      status: kr.status,
      progress,
      confidence: kr.confidence,
      ownerId: null,
      riskScore: computeAttentionRiskScore({
        progress,
        elapsedPercent,
        confidence: kr.confidence,
        stale,
        behind,
      }),
      reasons,
      freshness: makeOkrDashboardFreshness({
        source: OKR_DASHBOARD_SOURCES.KEY_RESULT,
        lastUpdatedAt: kr.lastUpdatedAt,
        staleThresholdMinutes: staleMinutes,
        now,
      }),
      target: null,
      warnings: [],
    })
  }
  // Objective 级别的 attention（缺 KR / weak alignment 由 alignment health 处理，这里补 no KR）
  const objectiveKrCounts = new Map<number, number>()
  for (const kr of visibleKeyResults) {
    objectiveKrCounts.set(kr.objectiveId, (objectiveKrCounts.get(kr.objectiveId) ?? 0) + 1)
  }
  for (const o of visibleObjectives) {
    if (o.status === 'archived' || o.status === 'completed') continue
    const krCount = objectiveKrCounts.get(o.id) ?? 0
    const reasons: OkrDashboardAttentionReason[] = []
    if (krCount === 0) reasons.push(OKR_DASHBOARD_ATTENTION_REASONS.MISSING_KEY_RESULTS)
    if (
      elapsedPercent !== null &&
      o.progress + OKR_DASHBOARD_BEHIND_MARGIN_PERCENT < elapsedPercent
    )
      reasons.push(OKR_DASHBOARD_ATTENTION_REASONS.BEHIND_TARGET)
    if (reasons.length === 0) continue
    attentionCandidates.push({
      kind: 'objective',
      entityId: o.id,
      title: o.title,
      scope: o.scope,
      status: o.status,
      progress: o.progress,
      confidence: o.confidence,
      ownerId: o.ownerId,
      riskScore: computeAttentionRiskScore({
        progress: o.progress,
        elapsedPercent,
        confidence: o.confidence,
        stale: false,
        behind: reasons.includes(OKR_DASHBOARD_ATTENTION_REASONS.BEHIND_TARGET),
      }),
      reasons,
      freshness: makeOkrDashboardFreshness({
        source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
        lastUpdatedAt: o.updatedAt,
        staleThresholdMinutes: staleMinutes,
        now,
      }),
      target: null,
      warnings: [],
    })
  }

  attentionCandidates.sort((a, b) => {
    const cmp = compareAttention(a, b, normalized.attentionSort)
    return normalized.attentionOrder === 'asc' ? cmp : -cmp
  })

  const attention = attentionCandidates.slice(0, normalized.attentionLimit)
  if (attentionCandidates.length > attention.length) {
    warnings.push(okrDashboardAttentionTruncatedWarning())
  }

  // Alignment health
  const objectiveIds = new Set(visibleObjectives.map((o) => o.id))
  const orphanObjectives = visibleObjectives.filter((o) => {
    if (o.scope === 'organization' || o.scope === 'individual') return false
    return !visibleAlignments.some(
      (a) => a.childObjectiveId === o.id && objectiveIds.has(a.parentObjectiveId),
    )
  })
  const weakAlignments = visibleAlignments.filter((a) => {
    const parent = visibleObjectives.find((o) => o.id === a.parentObjectiveId)
    return parent
      ? parent.status === 'archived' || parent.status === 'completed' || parent.deletedAt !== null
      : true
  })
  const alignmentHealth: OkrDashboardAlignmentHealth = {
    available: true,
    forbidden: false,
    healthScore: computeAlignmentHealthScore({
      total: visibleObjectives.length,
      orphan: orphanObjectives.length,
      weak: weakAlignments.length,
    }),
    orphanObjectiveCount: orphanObjectives.length,
    weakAlignmentCount: weakAlignments.length,
    disabledScopeReferences: visibleObjectives.filter((o) => o.scope === 'individual').length,
    maxDepth: null,
    warnings: [],
  }
  if (orphanObjectives.length > 0)
    alignmentHealth.warnings.push(okrDashboardOrphanObjectiveWarning())
  if (weakAlignments.length > 0) alignmentHealth.warnings.push(okrDashboardWeakAlignmentWarning())
  if (alignmentHealth.disabledScopeReferences && alignmentHealth.disabledScopeReferences > 0)
    alignmentHealth.warnings.push(okrDashboardDisabledScopeWarning())

  // Evidence freshness
  const evidenceStaleThresholdMs = staleMinutes * 60 * 1000
  const staleEvidence = visibleEvidence.filter(
    (e) => now - new Date(e.lastSeenAt).getTime() > evidenceStaleThresholdMs,
  )
  const freshestAt =
    visibleEvidence.length === 0
      ? null
      : (visibleEvidence
          .map((e) => e.lastSeenAt)
          .sort()
          .slice(-1)[0] ?? null)
  const stalestAt =
    visibleEvidence.length === 0
      ? null
      : (visibleEvidence
          .map((e) => e.lastSeenAt)
          .sort()
          .slice(0, 1)[0] ?? null)
  const evidenceFreshness: OkrDashboardEvidenceFreshness = {
    available: true,
    forbidden: false,
    totalEvidence: visibleEvidence.length,
    staleEvidence: staleEvidence.length,
    restrictedEvidence: restrictedEvidenceCount,
    freshestAt,
    stalestAt,
    warnings: restrictedEvidenceCount > 0 ? [okrDashboardRestrictedEvidenceWarning()] : [],
  }

  // Backflow
  const backflow: OkrDashboardBackflowSummary = (() => {
    const b = input.backflow
    if (!b || b.unavailable) {
      warnings.push(okrDashboardBackflowUnavailableWarning())
      return {
        available: false,
        forbidden: false,
        candidateCount: null,
        conflictCount: null,
        staleCount: null,
        lastRefreshedAt: null,
        targets: [],
        warnings: [okrDashboardBackflowUnavailableWarning()],
      }
    }
    if (b.forbidden) {
      warnings.push(okrDashboardBackflowForbiddenWarning())
      return {
        available: false,
        forbidden: true,
        candidateCount: null,
        conflictCount: null,
        staleCount: null,
        lastRefreshedAt: null,
        targets: [],
        warnings: [okrDashboardBackflowForbiddenWarning()],
      }
    }
    return {
      available: b.available !== false,
      forbidden: false,
      candidateCount: b.candidateCount ?? 0,
      conflictCount: b.conflictCount ?? 0,
      staleCount: b.staleCount ?? 0,
      lastRefreshedAt: b.lastRefreshedAt ?? null,
      targets: b.targets ?? [],
      warnings: [],
    }
  })()

  // 附加 backflow KPI（可选 metric，仅在有摘要时给数值）
  if (backflow.available && backflow.candidateCount !== null) {
    kpis.push({
      key: OKR_DASHBOARD_METRIC_KEYS.BACKFLOW_CANDIDATE_COUNT,
      value: backflow.candidateCount,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.BACKFLOW,
      status: OKR_DASHBOARD_STATUSES.OK,
    })
    kpis.push({
      key: OKR_DASHBOARD_METRIC_KEYS.BACKFLOW_CONFLICT_COUNT,
      value: backflow.conflictCount ?? 0,
      unit: 'count',
      source: OKR_DASHBOARD_SOURCES.BACKFLOW,
      status: OKR_DASHBOARD_STATUSES.OK,
    })
  }

  // Alignment health / orphan / weak KPI
  kpis.push({
    key: OKR_DASHBOARD_METRIC_KEYS.ALIGNMENT_HEALTH_SCORE,
    value: alignmentHealth.healthScore ?? 0,
    unit: 'score',
    source: OKR_DASHBOARD_SOURCES.ALIGNMENT,
    status: OKR_DASHBOARD_STATUSES.OK,
  })
  kpis.push({
    key: OKR_DASHBOARD_METRIC_KEYS.ORPHAN_OBJECTIVE_COUNT,
    value: alignmentHealth.orphanObjectiveCount ?? 0,
    unit: 'count',
    source: OKR_DASHBOARD_SOURCES.ALIGNMENT,
    status: OKR_DASHBOARD_STATUSES.OK,
  })
  kpis.push({
    key: OKR_DASHBOARD_METRIC_KEYS.WEAK_ALIGNMENT_COUNT,
    value: alignmentHealth.weakAlignmentCount ?? 0,
    unit: 'count',
    source: OKR_DASHBOARD_SOURCES.ALIGNMENT,
    status: OKR_DASHBOARD_STATUSES.OK,
  })
  kpis.push({
    key: OKR_DASHBOARD_METRIC_KEYS.STALE_EVIDENCE_COUNT,
    value: evidenceFreshness.staleEvidence ?? 0,
    unit: 'count',
    source: OKR_DASHBOARD_SOURCES.EVIDENCE,
    status: OKR_DASHBOARD_STATUSES.OK,
  })
  kpis.push({
    key: OKR_DASHBOARD_METRIC_KEYS.RECENT_PROGRESS_COUNT,
    value: input.progressHistory.length,
    unit: 'count',
    source: OKR_DASHBOARD_SOURCES.PROGRESS_HISTORY,
    status: OKR_DASHBOARD_STATUSES.OK,
  })

  if (restrictedObjectiveCount > 0 || restrictedKeyResultCount > 0)
    warnings.push(okrDashboardSourcePartialWarning(OKR_DASHBOARD_SOURCES.OBJECTIVE))

  // Freshness 汇总
  const sourceFreshness: OkrDashboardSourceFreshness[] = [
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.CYCLE,
      lastUpdatedAt: input.freshness?.cycle ?? null,
      staleThresholdMinutes: staleMinutes,
      now,
    }),
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.OBJECTIVE,
      lastUpdatedAt: input.freshness?.objective ?? null,
      staleThresholdMinutes: staleMinutes,
      now,
    }),
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.KEY_RESULT,
      lastUpdatedAt: input.freshness?.keyResult ?? null,
      staleThresholdMinutes: staleMinutes,
      now,
    }),
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.ALIGNMENT,
      lastUpdatedAt: input.freshness?.alignment ?? null,
      staleThresholdMinutes: staleMinutes,
      now,
    }),
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.EVIDENCE,
      lastUpdatedAt: input.freshness?.evidence ?? null,
      staleThresholdMinutes: staleMinutes,
      now,
    }),
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.PROGRESS_HISTORY,
      lastUpdatedAt: input.freshness?.progressHistory ?? null,
      staleThresholdMinutes: staleMinutes,
      now,
    }),
    makeOkrDashboardFreshness({
      source: OKR_DASHBOARD_SOURCES.BACKFLOW,
      lastUpdatedAt: input.freshness?.backflow ?? null,
      staleThresholdMinutes: staleMinutes,
      unavailable: !backflow.available && !backflow.forbidden,
      forbidden: backflow.forbidden,
      now,
    }),
  ]

  const inputSignatureHash = okrDashboardStableHash(
    JSON.stringify({
      org: input.organizationId,
      actor: input.actorId,
      cycle: input.cycle.cycleId,
      obj: visibleObjectives.length,
      kr: visibleKeyResults.length,
      al: visibleAlignments.length,
      ev: visibleEvidence.length,
      ph: input.progressHistory.length,
      q: normalized,
    }),
  )

  const meta: OkrDashboardMeta = {
    calculatedAt: nowIso,
    metricVersion: OKR_DASHBOARD_METRIC_VERSION,
    organizationId: input.organizationId,
    actorId: input.actorId,
    cycleId: input.cycle.cycleId,
    visibleObjectiveCount: visibleObjectives.length,
    visibleKeyResultCount: visibleKeyResults.length,
    restrictedObjectiveCount,
    restrictedKeyResultCount,
    sections: normalized.sections,
    attentionLimit: normalized.attentionLimit,
    staleThresholdMinutes: staleMinutes,
    inputSignatureHash,
  }

  return {
    meta,
    cycleContext,
    kpis,
    progressDistribution,
    statusDistribution,
    attention,
    alignmentHealth,
    evidenceFreshness,
    backflow,
    sourceFreshness,
    warnings: mergeOkrDashboardWarnings(warnings),
  }
}

function compareAttention(
  a: OkrDashboardAttentionItem,
  b: OkrDashboardAttentionItem,
  sort: OkrDashboardAttentionSortKey,
): number {
  switch (sort) {
    case OKR_DASHBOARD_ATTENTION_SORT_KEYS.PROGRESS:
      return a.progress - b.progress
    case OKR_DASHBOARD_ATTENTION_SORT_KEYS.CONFIDENCE: {
      const rank: Record<OkrConfidenceLevel, number> = { low: 0, medium: 1, high: 2 }
      return rank[a.confidence] - rank[b.confidence]
    }
    case OKR_DASHBOARD_ATTENTION_SORT_KEYS.UPDATED_AT: {
      const at = a.freshness?.lastUpdatedAt ?? ''
      const bt = b.freshness?.lastUpdatedAt ?? ''
      return at.localeCompare(bt)
    }
    case OKR_DASHBOARD_ATTENTION_SORT_KEYS.TITLE:
      return a.title.localeCompare(b.title, 'zh-Hans')
    case OKR_DASHBOARD_ATTENTION_SORT_KEYS.RISK_SCORE:
    default:
      return a.riskScore - b.riskScore
  }
}

function computeAlignmentHealthScore(input: {
  total: number
  orphan: number
  weak: number
}): number | null {
  if (input.total === 0) return null
  const orphanPenalty = Math.min(50, (input.orphan / input.total) * 100)
  const weakPenalty = Math.min(30, (input.weak / Math.max(1, input.total)) * 100)
  return Math.max(0, Math.round(100 - orphanPenalty - weakPenalty))
}

// ─── Fixture builders ─────────────────────────────────────────────────────────

/**
 * 构造 OKR Dashboard 聚合 helper 的输入 fixture：默认周期 / 3 objective / 3 KR /
 * 1 alignment / 1 evidence / 1 progress history 记录，可通过 overrides 微调。
 */
export function makeOkrDashboardFixtureInput(
  overrides: Partial<ComputeOkrDashboardSummaryInput> = {},
): ComputeOkrDashboardSummaryInput {
  const now = overrides.now ?? Date.parse('2026-07-30T12:00:00.000Z')
  const base: ComputeOkrDashboardSummaryInput = {
    organizationId: 1,
    actorId: 1,
    now,
    cycle: {
      cycleId: 1,
      title: 'Q3 2026',
      status: 'active',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
    },
    objectives: [],
    keyResults: [],
    alignments: [],
    evidence: [],
    progressHistory: [],
    restrictedObjectiveCount: 0,
    restrictedKeyResultCount: 0,
    restrictedEvidenceCount: 0,
    freshness: {
      cycle: new Date(now - 60_000).toISOString(),
      objective: new Date(now - 60_000).toISOString(),
      keyResult: new Date(now - 60_000).toISOString(),
      alignment: new Date(now - 60_000).toISOString(),
      evidence: new Date(now - 60_000).toISOString(),
      progressHistory: new Date(now - 60_000).toISOString(),
    },
    normalizedQuery: normalizeOkrDashboardQuery({}),
  }
  return { ...base, ...overrides }
}

/**
 * 构造大规模 fixture：≥1000 objective + 4000 KR（默认 1000×4），
 * 用于 §6.1 大组织性能验证。attention 会被截断到 limit。
 */
export function makeOkrDashboardLargeFixtureInput(
  options: {
    objectiveCount?: number
    keyResultsPerObjective?: number
    organizationId?: number
  } = {},
): ComputeOkrDashboardSummaryInput {
  const objectiveCount = options.objectiveCount ?? 1000
  const krPer = options.keyResultsPerObjective ?? 4
  const organizationId = options.organizationId ?? 1
  const objectives: OkrObjective[] = []
  const keyResults: OkrKeyResult[] = []
  const alignments: OkrAlignment[] = []
  for (let i = 0; i < objectiveCount; i += 1) {
    const objId = i + 1
    objectives.push({
      id: objId,
      organizationId,
      cycleId: 1,
      projectId: null,
      teamId: null,
      ownerId: null,
      scope: 'team',
      title: `Objective ${objId}`,
      description: null,
      status: i % 10 === 0 ? 'draft' : 'active',
      weight: 1,
      progress: i % 100,
      confidence: i % 3 === 0 ? 'low' : i % 3 === 1 ? 'medium' : 'high',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
      metricVersion: OKR_METRIC_VERSION,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      deletedAt: null,
    })
    for (let j = 0; j < krPer; j += 1) {
      const krId = objId * 10 + j
      keyResults.push({
        id: krId,
        organizationId,
        objectiveId: objId,
        title: `KR ${krId}`,
        description: null,
        measurementType: 'number',
        unitLabel: null,
        baselineValue: 0,
        targetValue: 100,
        currentValue: (i + j) % 100,
        confidence: (i + j) % 3 === 0 ? 'low' : 'medium',
        status: 'active',
        weight: 1,
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
        deletedAt: null,
      })
    }
    if (i > 0 && i % 5 === 0) {
      alignments.push({
        id: alignments.length + 1,
        organizationId,
        childObjectiveId: objId,
        parentObjectiveId: 1,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        deletedAt: null,
      })
    }
  }
  return makeOkrDashboardFixtureInput({
    organizationId,
    objectives,
    keyResults,
    alignments,
    normalizedQuery: normalizeOkrDashboardQuery({ attentionLimit: 20 }),
  })
}

/**
 * 构造受限证据 fixture：15 个证据其中 5 个 restricted，通过 restrictedEvidenceCount
 * 反映在 evidenceFreshness 与 RESTRICTED_EVIDENCE warning。
 */
export function makeOkrDashboardRestrictedEvidenceFixtureInput(
  organizationId = 1,
): ComputeOkrDashboardSummaryInput {
  const nowIso = '2026-07-30T12:00:00.000Z'
  const evidence: OkrEvidenceLink[] = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    organizationId,
    targetType: 'key_result',
    targetId: 1,
    sourceKind: 'project',
    sourceId: 1,
    summary: `evidence ${i + 1}`,
    hash: `hash-${i + 1}`,
    lastSeenAt: '2026-07-29T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    deletedAt: null,
  }))
  return makeOkrDashboardFixtureInput({
    organizationId,
    evidence,
    restrictedEvidenceCount: 5,
    now: Date.parse(nowIso),
  })
}

/**
 * 构造 backflow unavailable / available / forbidden 的三种 fixture。
 */
export function makeOkrDashboardBackflowFixtures(): {
  unavailable: ComputeOkrDashboardSummaryInput
  available: ComputeOkrDashboardSummaryInput
  forbidden: ComputeOkrDashboardSummaryInput
} {
  return {
    unavailable: makeOkrDashboardFixtureInput({ backflow: { unavailable: true } }),
    available: makeOkrDashboardFixtureInput({
      backflow: {
        available: true,
        candidateCount: 3,
        conflictCount: 1,
        staleCount: 0,
        lastRefreshedAt: '2026-07-30T11:00:00.000Z',
      },
    }),
    forbidden: makeOkrDashboardFixtureInput({ backflow: { forbidden: true } }),
  }
}
