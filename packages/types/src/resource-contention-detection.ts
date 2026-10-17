// @aiproj/types —— 资源争用检测共享契约（前后端共享）。
// v3-resource-contention-detection §2：DTO、枚举、常量、warning、纯函数助手。
//
// 红线：
//   - 只读聚合，无副作用；不含财务/预算/ROI/成本一等字段。
//   - 权限受限维度只返回低敏 forbidden/unavailable/redacted 状态。
//   - AI 建议只产出卡片/preview，不写正式数据。
//   - 检测结果非阻断，硬错误仍由 Validator/Policy 负责。

// ─── Severity ────────────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_SEVERITIES = {
  INFO: 'info',
  WARNING: 'warning',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const

export type ResourceContentionSeverity =
  (typeof RESOURCE_CONTENTION_SEVERITIES)[keyof typeof RESOURCE_CONTENTION_SEVERITIES]

export const RESOURCE_CONTENTION_SEVERITY_VALUES = Object.values(
  RESOURCE_CONTENTION_SEVERITIES,
) as readonly ResourceContentionSeverity[]

export const RESOURCE_CONTENTION_SEVERITY_ORDER: Record<ResourceContentionSeverity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
}

// ─── Reason Codes ────────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_REASON_CODES = {
  CROSS_PROJECT_OVERLOAD: 'cross-project-overload',
  UNAVAILABLE_ALLOCATION: 'unavailable-allocation',
  CRITICAL_SKILL_CONTENTION: 'critical-skill-contention',
  DUPLICATE_RESERVATION: 'duplicate-reservation',
  DEMAND_WINDOW_CONTENTION: 'demand-window-contention',
  DRAFT_ALLOCATION_CONTENTION: 'draft-allocation-contention',
} as const

export type ResourceContentionReasonCode =
  (typeof RESOURCE_CONTENTION_REASON_CODES)[keyof typeof RESOURCE_CONTENTION_REASON_CODES]

export const RESOURCE_CONTENTION_REASON_CODE_VALUES = Object.values(
  RESOURCE_CONTENTION_REASON_CODES,
) as readonly ResourceContentionReasonCode[]

export const RESOURCE_CONTENTION_REASON_ORDER: Record<ResourceContentionReasonCode, number> = {
  'cross-project-overload': 0,
  'unavailable-allocation': 1,
  'critical-skill-contention': 2,
  'duplicate-reservation': 3,
  'demand-window-contention': 4,
  'draft-allocation-contention': 5,
}

// ─── Redaction States ────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_REDACTION_STATES = {
  VISIBLE: 'visible',
  REDACTED: 'redacted',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  PARTIAL: 'partial',
} as const

export type ResourceContentionRedactionState =
  (typeof RESOURCE_CONTENTION_REDACTION_STATES)[keyof typeof RESOURCE_CONTENTION_REDACTION_STATES]

export const RESOURCE_CONTENTION_REDACTION_STATE_VALUES = Object.values(
  RESOURCE_CONTENTION_REDACTION_STATES,
) as readonly ResourceContentionRedactionState[]

// ─── Warning Codes ───────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_WARNING_CODES = {
  EMPTY_CONTENTION_RESULT: 'EMPTY_CONTENTION_RESULT',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_PARTIAL: 'SOURCE_PARTIAL',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  LOW_CARDINALITY_REDACTED: 'LOW_CARDINALITY_REDACTED',
  DRILL_DOWN_FORBIDDEN: 'DRILL_DOWN_FORBIDDEN',
  AI_SUGGESTION_UNAVAILABLE: 'AI_SUGGESTION_UNAVAILABLE',
  CROSS_PROJECT_CONTENTION_REDACTED: 'CROSS_PROJECT_CONTENTION_REDACTED',
} as const

export type ResourceContentionWarningCode =
  (typeof RESOURCE_CONTENTION_WARNING_CODES)[keyof typeof RESOURCE_CONTENTION_WARNING_CODES]

export const RESOURCE_CONTENTION_WARNING_CODE_VALUES = Object.values(
  RESOURCE_CONTENTION_WARNING_CODES,
) as readonly ResourceContentionWarningCode[]

// ─── Source Keys ─────────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_SOURCES = {
  RESOURCE_REGISTRY: 'resource_registry',
  RESOURCE_ALLOCATION: 'resource_allocation',
  RESOURCE_REQUIREMENT: 'resource_requirement',
  RESOURCE_AVAILABILITY: 'resource_availability',
  PROJECT: 'project',
  ORGANIZATION_RESOURCE_POOL: 'organization_resource_pool',
  CROSS_PROJECT_DRAFT: 'cross_project_draft',
  COMPUTED: 'computed',
} as const

export type ResourceContentionSource =
  (typeof RESOURCE_CONTENTION_SOURCES)[keyof typeof RESOURCE_CONTENTION_SOURCES]

export const RESOURCE_CONTENTION_SOURCE_VALUES = Object.values(
  RESOURCE_CONTENTION_SOURCES,
) as readonly ResourceContentionSource[]

// ─── Drill-Down Target Types ─────────────────────────────────────────────────

export const RESOURCE_CONTENTION_TARGET_KINDS = {
  PROJECT: 'project',
  RESOURCE: 'resource',
  TASK: 'task',
  ALLOCATION: 'allocation',
  SKILL: 'skill',
  DEMAND: 'demand',
  DRAFT: 'draft',
  EVIDENCE: 'evidence',
} as const

export type ResourceContentionTargetKind =
  (typeof RESOURCE_CONTENTION_TARGET_KINDS)[keyof typeof RESOURCE_CONTENTION_TARGET_KINDS]

export const RESOURCE_CONTENTION_TARGET_KIND_VALUES = Object.values(
  RESOURCE_CONTENTION_TARGET_KINDS,
) as readonly ResourceContentionTargetKind[]

// ─── View Modes ──────────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_VIEW_MODES = {
  SUMMARY: 'summary',
  LIST: 'list',
  MATRIX: 'matrix',
  TIMELINE: 'timeline',
} as const

export type ResourceContentionViewMode =
  (typeof RESOURCE_CONTENTION_VIEW_MODES)[keyof typeof RESOURCE_CONTENTION_VIEW_MODES]

export const RESOURCE_CONTENTION_VIEW_MODE_VALUES = Object.values(
  RESOURCE_CONTENTION_VIEW_MODES,
) as readonly ResourceContentionViewMode[]

// ─── Sort Keys ───────────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_SORT_KEYS = {
  SEVERITY: 'severity',
  REASON: 'reason',
  DATE: 'date',
  RESOURCE_NAME: 'resource_name',
  PROJECT_COUNT: 'project_count',
  LOAD_PERCENT: 'load_percent',
  UPDATED_AT: 'updated_at',
} as const

export type ResourceContentionSortKey =
  (typeof RESOURCE_CONTENTION_SORT_KEYS)[keyof typeof RESOURCE_CONTENTION_SORT_KEYS]

export const RESOURCE_CONTENTION_SORT_KEY_VALUES = Object.values(
  RESOURCE_CONTENTION_SORT_KEYS,
) as readonly ResourceContentionSortKey[]

// ─── Constants ───────────────────────────────────────────────────────────────

export const RESOURCE_CONTENTION_METRIC_VERSION = 'resource-contention-detection.v1' as const
export const RESOURCE_CONTENTION_DEFAULT_PAGE = 1
export const RESOURCE_CONTENTION_DEFAULT_PER_PAGE = 20
export const RESOURCE_CONTENTION_MAX_PER_PAGE = 100
export const RESOURCE_CONTENTION_MAX_TOP_N = 50
export const RESOURCE_CONTENTION_DEFAULT_DATE_WINDOW_DAYS = 90
export const RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS = 366
export const RESOURCE_CONTENTION_STALE_THRESHOLD_MINUTES = 60
export const RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES = 1440
export const RESOURCE_CONTENTION_MAX_SEARCH_LENGTH = 200
export const RESOURCE_CONTENTION_LOW_CARDINALITY_THRESHOLD = 3
export const RESOURCE_CONTENTION_DEFAULT_OVERLOADED_THRESHOLD = 100
export const RESOURCE_CONTENTION_OVERLOAD_SEVERITY_THRESHOLD = 150

// ─── DTO: Evidence ───────────────────────────────────────────────────────────

export interface ResourceContentionEvidence {
  /** 低敏 evidence hash——仅 hash/timestamp/id，不含证据原文 */
  evidenceHash: string
  source: ResourceContentionSource
  lastUpdatedAt: string | null
  metricKeys: string[]
  isLowSensitive: boolean
}

// ─── DTO: Warning ────────────────────────────────────────────────────────────

export interface ResourceContentionWarning {
  code: ResourceContentionWarningCode
  message: string
  source?: ResourceContentionSource
  metricKey?: string
}

// ─── DTO: Freshness ──────────────────────────────────────────────────────────

export interface ResourceContentionSourceFreshness {
  source: ResourceContentionSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
  status: ResourceContentionRedactionState
}

// ─── DTO: Drill-Down Target ─────────────────────────────────────────────────

export interface ResourceContentionTarget {
  kind: ResourceContentionTargetKind
  href: string
  authorized: boolean
}

// ─── DTO: Query ──────────────────────────────────────────────────────────────

export interface ResourceContentionQuery {
  from?: string
  to?: string
  view?: ResourceContentionViewMode
  severity?: ResourceContentionSeverity
  reasonCode?: ResourceContentionReasonCode
  projectIds?: number[]
  resourceIds?: number[]
  skillIds?: number[]
  aggregation?: 'none' | 'by_resource' | 'by_project' | 'by_skill' | 'by_date'
  sort?: ResourceContentionSortKey
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
  topN?: number
  freshnessWindowMinutes?: number
}

export interface NormalizedResourceContentionQuery {
  from: string | null
  to: string | null
  view: ResourceContentionViewMode
  severity: ResourceContentionSeverity | null
  reasonCode: ResourceContentionReasonCode | null
  projectIds: number[] | null
  resourceIds: number[] | null
  skillIds: number[] | null
  aggregation: 'none' | 'by_resource' | 'by_project' | 'by_skill' | 'by_date'
  sort: ResourceContentionSortKey
  order: 'asc' | 'desc'
  page: number
  perPage: number
  topN: number
  freshnessWindowMinutes: number
}

// ─── DTO: Contention Item ───────────────────────────────────────────────────

export interface ResourceContentionItem {
  contentionId: string
  severity: ResourceContentionSeverity
  reasonCode: ResourceContentionReasonCode
  resourceId: number | null
  resourceName: string | null
  projectIds: number[] | null
  projectNames: string[] | null
  taskId: number | null
  allocationId: number | null
  from: string
  to: string
  loadPercent: number | null
  affectedDateBuckets: string[] | null
  description: string
  remediationHint: string | null
  evidenceHash: string | null
  target: ResourceContentionTarget | null
  redactionState: ResourceContentionRedactionState
  createdAt: string
}

// ─── DTO: Contention Matrix ─────────────────────────────────────────────────

export interface ResourceContentionMatrixCell {
  date: string
  severity: ResourceContentionSeverity | null
  reasonCode: ResourceContentionReasonCode | null
  loadPercent: number | null
  contentionCount: number
  redactionState: ResourceContentionRedactionState
  drillDownTarget: ResourceContentionTarget | null
}

export interface ResourceContentionMatrixRow {
  resourceId: number
  resourceName: string | null
  role: string | null
  totalContentions: number
  maxSeverity: ResourceContentionSeverity | null
  cells: ResourceContentionMatrixCell[]
  redactionState: ResourceContentionRedactionState
}

export interface ResourceContentionMatrix {
  from: string
  to: string
  rows: ResourceContentionMatrixRow[]
}

// ─── DTO: Summary ────────────────────────────────────────────────────────────

export interface ResourceContentionMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  visibleProjectCount: number
  visibleResourceCount: number
  querySignatureHash: string
  sourceSignatureHash: string
}

export interface ResourceContentionSummary {
  meta: ResourceContentionMeta
  severityCounts: Record<ResourceContentionSeverity, number>
  reasonCounts: Record<ResourceContentionReasonCode, number>
  affectedProjectCount: number
  affectedResourceCount: number
  totalContentions: number
  sourceFreshness: ResourceContentionSourceFreshness[]
  warnings: ResourceContentionWarning[]
  evidenceHashes: string[]
}

// ─── DTO: Suggestion Preview ────────────────────────────────────────────────

export interface ResourceContentionSuggestionPreview {
  suggestionId: string
  contentionId: string
  kind: 'rule' | 'ai'
  title: string
  description: string
  candidateActions: string[]
  isAdvisory: boolean
  redactionState: ResourceContentionRedactionState
  createdAt: string
}

// ─── DTO: Response Envelopes ─────────────────────────────────────────────────

export interface ResourceContentionEnvelope<T> {
  data: T
  meta: {
    total?: number
    page?: number
    perPage?: number
    totalPages?: number
  }
}

// ─── DTO: Audit ──────────────────────────────────────────────────────────────

export interface ResourceContentionReadAudit {
  actorId: number
  organizationId: number
  endpointFamily: string
  querySignatureHash: string
  severityCounts: Record<string, number>
  reasonCodes: string[]
  warningCodes: string[]
  sourceFreshnessHash: string
  occurredAt: string
}

// ─── Pure Helpers ───────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** 稳定 FNV-1a 哈希——用于 query signature 与 evidence 指纹，不含敏感原文。 */
export function resourceContentionStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 归一化查询：view 白名单、date window clamp、分页 clamp、search 截断。 */
export function normalizeResourceContentionQuery(
  query: ResourceContentionQuery = {},
): NormalizedResourceContentionQuery {
  const from = query.from ?? null
  const to = query.to ?? null

  let resolvedFrom = from
  let resolvedTo = to
  if (from && to) {
    const fromMs = new Date(from).getTime()
    const toMs = new Date(to).getTime()
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24)
      if (diffDays > RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS) {
        resolvedTo = new Date(
          fromMs + RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
      }
    }
  }

  return {
    from: resolvedFrom,
    to: resolvedTo,
    view:
      query.view && RESOURCE_CONTENTION_VIEW_MODE_VALUES.includes(query.view)
        ? query.view
        : RESOURCE_CONTENTION_VIEW_MODES.SUMMARY,
    severity:
      query.severity && RESOURCE_CONTENTION_SEVERITY_VALUES.includes(query.severity)
        ? query.severity
        : null,
    reasonCode:
      query.reasonCode && RESOURCE_CONTENTION_REASON_CODE_VALUES.includes(query.reasonCode)
        ? query.reasonCode
        : null,
    projectIds: query.projectIds?.length
      ? query.projectIds.map(Number).filter((n) => Number.isFinite(n))
      : null,
    resourceIds: query.resourceIds?.length
      ? query.resourceIds.map(Number).filter((n) => Number.isFinite(n))
      : null,
    skillIds: query.skillIds?.length
      ? query.skillIds.map(Number).filter((n) => Number.isFinite(n))
      : null,
    aggregation: query.aggregation ?? 'none',
    sort:
      query.sort && RESOURCE_CONTENTION_SORT_KEY_VALUES.includes(query.sort)
        ? query.sort
        : RESOURCE_CONTENTION_SORT_KEYS.SEVERITY,
    order: query.order === 'asc' ? 'asc' : 'desc',
    page: clamp(query.page ?? RESOURCE_CONTENTION_DEFAULT_PAGE, 1, 10_000),
    perPage: clamp(
      query.perPage ?? RESOURCE_CONTENTION_DEFAULT_PER_PAGE,
      1,
      RESOURCE_CONTENTION_MAX_PER_PAGE,
    ),
    topN: clamp(query.topN ?? RESOURCE_CONTENTION_MAX_TOP_N, 1, RESOURCE_CONTENTION_MAX_TOP_N),
    freshnessWindowMinutes: clamp(
      query.freshnessWindowMinutes ?? RESOURCE_CONTENTION_STALE_THRESHOLD_MINUTES,
      1,
      RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES,
    ),
  }
}

// ─── Severity Derivation ─────────────────────────────────────────────────────

export function deriveResourceContentionSeverity(input: {
  overloadRatio?: number | null
  unavailableCapacity?: boolean
  affectedProjectCount?: number
  criticalSkill?: boolean
  dateProximityDays?: number | null
  isDraft?: boolean
}): ResourceContentionSeverity {
  const ratio = input.overloadRatio ?? 0
  const projects = input.affectedProjectCount ?? 0
  const days = input.dateProximityDays ?? Number.MAX_SAFE_INTEGER

  // CRITICAL: unavailable allocation, or extreme overload
  if (input.unavailableCapacity) return RESOURCE_CONTENTION_SEVERITIES.CRITICAL
  if (ratio >= RESOURCE_CONTENTION_OVERLOAD_SEVERITY_THRESHOLD)
    return RESOURCE_CONTENTION_SEVERITIES.CRITICAL
  if (input.criticalSkill && projects >= 3) return RESOURCE_CONTENTION_SEVERITIES.CRITICAL

  // HIGH: high overload, critical skill, or close date + many projects
  if (ratio >= 120) return RESOURCE_CONTENTION_SEVERITIES.HIGH
  if (input.criticalSkill && projects >= 2) return RESOURCE_CONTENTION_SEVERITIES.HIGH
  if (projects >= 5 && days <= 7) return RESOURCE_CONTENTION_SEVERITIES.HIGH

  // WARNING: moderate overload, multiple projects
  if (ratio >= 100) return RESOURCE_CONTENTION_SEVERITIES.WARNING
  if (projects >= 3) return RESOURCE_CONTENTION_SEVERITIES.WARNING
  if (input.isDraft) return RESOURCE_CONTENTION_SEVERITIES.WARNING

  return RESOURCE_CONTENTION_SEVERITIES.INFO
}

// ─── Reason Ordering ─────────────────────────────────────────────────────────

export function sortContentionReasons(
  reasons: ResourceContentionReasonCode[],
): ResourceContentionReasonCode[] {
  return [...reasons].sort(
    (a, b) =>
      (RESOURCE_CONTENTION_REASON_ORDER[a] ?? 99) - (RESOURCE_CONTENTION_REASON_ORDER[b] ?? 99),
  )
}

// ─── Load Bucket Normalization ───────────────────────────────────────────────

export function normalizeLoadBucket(loadPercent: number): {
  status: 'idle' | 'normal' | 'high' | 'overloaded'
  percent: number
} {
  const percent = Math.round(Math.max(0, loadPercent) * 10) / 10
  let status: 'idle' | 'normal' | 'high' | 'overloaded'
  if (percent <= 10) status = 'idle'
  else if (percent <= 80) status = 'normal'
  else if (percent <= 100) status = 'high'
  else status = 'overloaded'
  return { status, percent }
}

// ─── Warning Conversion ──────────────────────────────────────────────────────

export function makeContentionWarning(
  code: ResourceContentionWarningCode,
  message: string,
  source?: ResourceContentionSource,
  metricKey?: string,
): ResourceContentionWarning {
  return { code, message, source, metricKey }
}

// ─── Freshness Helpers ──────────────────────────────────────────────────────

export function isResourceContentionSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number = RESOURCE_CONTENTION_STALE_THRESHOLD_MINUTES,
  now: number = Date.now(),
): boolean {
  if (!lastUpdatedAt) return true
  const last = new Date(lastUpdatedAt).getTime()
  if (!Number.isFinite(last)) return true
  return now - last > thresholdMinutes * 60 * 1000
}

export function makeResourceContentionFreshness(input: {
  source: ResourceContentionSource
  lastUpdatedAt: string | null
  staleThresholdMinutes?: number
  forbidden?: boolean
  unavailable?: boolean
  now?: number
}): ResourceContentionSourceFreshness {
  const staleThresholdMinutes =
    input.staleThresholdMinutes ?? RESOURCE_CONTENTION_STALE_THRESHOLD_MINUTES
  if (input.forbidden) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: RESOURCE_CONTENTION_REDACTION_STATES.FORBIDDEN,
    }
  }
  if (input.unavailable) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: RESOURCE_CONTENTION_REDACTION_STATES.UNAVAILABLE,
    }
  }
  const isStale = isResourceContentionSourceStale(
    input.lastUpdatedAt,
    staleThresholdMinutes,
    input.now,
  )
  return {
    source: input.source,
    lastUpdatedAt: input.lastUpdatedAt,
    isStale,
    staleThresholdMinutes,
    status: isStale
      ? RESOURCE_CONTENTION_REDACTION_STATES.UNAVAILABLE
      : RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE,
  }
}

export function resourceContentionFreshnessHash(
  freshness: ResourceContentionSourceFreshness,
): string {
  return resourceContentionStableHash(
    `${freshness.source}:${freshness.lastUpdatedAt ?? 'none'}:${freshness.status}`,
  )
}

export function mergeResourceContentionFreshness(
  items: ResourceContentionSourceFreshness[],
): ResourceContentionSourceFreshness | null {
  if (items.length === 0) return null
  const first = items[0]!
  let latest = first.lastUpdatedAt
  let anyStale = first.isStale
  let worstStatus = first.status
  for (let i = 1; i < items.length; i++) {
    const curr = items[i]!
    if (curr.lastUpdatedAt && (!latest || curr.lastUpdatedAt > latest)) {
      latest = curr.lastUpdatedAt
    }
    if (curr.isStale) anyStale = true
    if (
      curr.status === RESOURCE_CONTENTION_REDACTION_STATES.FORBIDDEN ||
      curr.status === RESOURCE_CONTENTION_REDACTION_STATES.UNAVAILABLE
    ) {
      worstStatus = curr.status
    }
  }
  return {
    source: RESOURCE_CONTENTION_SOURCES.COMPUTED,
    lastUpdatedAt: latest,
    isStale: anyStale,
    staleThresholdMinutes: first.staleThresholdMinutes,
    status:
      worstStatus === RESOURCE_CONTENTION_REDACTION_STATES.FORBIDDEN
        ? worstStatus
        : anyStale
          ? RESOURCE_CONTENTION_REDACTION_STATES.UNAVAILABLE
          : RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE,
  }
}

// ─── Warning Merging ─────────────────────────────────────────────────────────

export function mergeResourceContentionWarnings(
  ...groups: Array<ResourceContentionWarning[] | undefined>
): ResourceContentionWarning[] {
  const seen = new Set<string>()
  const merged: ResourceContentionWarning[] = []
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

// ─── Evidence Helpers ────────────────────────────────────────────────────────

export function computeEvidenceKey(parts: string[]): string {
  return resourceContentionStableHash(parts.join(':'))
}

export function makeLowSensitiveEvidenceHash(
  source: ResourceContentionSource,
  ids: string[],
  timestamp: string,
): string {
  return resourceContentionStableHash(`${source}:${ids.join(':')}:${timestamp}`)
}

export function computeQuerySignatureHash(query: NormalizedResourceContentionQuery): string {
  return resourceContentionStableHash(
    `${query.from ?? ''}:${query.to ?? ''}:${query.view}:${query.severity ?? ''}:${query.reasonCode ?? ''}:${(query.projectIds ?? []).join(',')}:${(query.resourceIds ?? []).join(',')}:${(query.skillIds ?? []).join(',')}:${query.aggregation}`,
  )
}

export function computeContentionSourceSignature(values: string[]): string {
  return resourceContentionStableHash(values.join(':'))
}

// ─── Validation Detail ──────────────────────────────────────────────────────

export interface ResourceContentionValidationDetail {
  allowedViews: readonly ResourceContentionViewMode[]
  allowedSorts: readonly ResourceContentionSortKey[]
  allowedSeverities: readonly ResourceContentionSeverity[]
  allowedReasonCodes: readonly ResourceContentionReasonCode[]
  allowedAggregations: readonly string[]
  maxDateWindowDays: number
  maxPerPage: number
  maxTopN: number
  maxFreshnessWindowMinutes: number
}

export function resourceContentionValidationDetail(): ResourceContentionValidationDetail {
  return {
    allowedViews: RESOURCE_CONTENTION_VIEW_MODE_VALUES,
    allowedSorts: RESOURCE_CONTENTION_SORT_KEY_VALUES,
    allowedSeverities: RESOURCE_CONTENTION_SEVERITY_VALUES,
    allowedReasonCodes: RESOURCE_CONTENTION_REASON_CODE_VALUES,
    allowedAggregations: ['none', 'by_resource', 'by_project', 'by_skill', 'by_date'],
    maxDateWindowDays: RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS,
    maxPerPage: RESOURCE_CONTENTION_MAX_PER_PAGE,
    maxTopN: RESOURCE_CONTENTION_MAX_TOP_N,
    maxFreshnessWindowMinutes: RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES,
  }
}

// ─── Severity Counts Builder ─────────────────────────────────────────────────

export function emptySeverityCounts(): Record<ResourceContentionSeverity, number> {
  return { info: 0, warning: 0, high: 0, critical: 0 }
}

export function emptyReasonCounts(): Record<ResourceContentionReasonCode, number> {
  return {
    'cross-project-overload': 0,
    'unavailable-allocation': 0,
    'critical-skill-contention': 0,
    'duplicate-reservation': 0,
    'demand-window-contention': 0,
    'draft-allocation-contention': 0,
  }
}
