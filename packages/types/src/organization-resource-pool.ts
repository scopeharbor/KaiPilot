// @aiproj/types —— 组织资源池共享契约（前后端共享）。
// v3-organization-resource-pool §2：DTO、枚举、常量、warning、纯函数助手与 fixture。
//
// 红线：
//   - 只读聚合，无副作用；不含财务/预算/ROI/成本一等字段。
//   - 权限受限维度只返回低敏 forbidden/unavailable/redacted 状态，不暴露隐藏计数、名称、证据文本或未授权 target。
//   - 所有 drill-down target 由后端授权后下发，前端不得自行拼装未授权链接。
//   - 组织资源池复用项目级资源事实，不创建第二套资源模型。

// ─── Metric Keys ───────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_METRIC_KEYS = {
  // 资源规模
  TOTAL_RESOURCES: 'org_respool_total_resources',
  ACTIVE_RESOURCES: 'org_respool_active_resources',
  LINKED_USER_COUNT: 'org_respool_linked_users',
  VISIBLE_PROJECT_COUNT: 'org_respool_visible_projects',

  // 容量
  TOTAL_CAPACITY_HOURS: 'org_respool_total_capacity_hours',
  ALLOCATED_CAPACITY_HOURS: 'org_respool_allocated_capacity_hours',
  REMAINING_CAPACITY_HOURS: 'org_respool_remaining_capacity_hours',
  AVERAGE_UTILIZATION_PERCENT: 'org_respool_avg_utilization_percent',

  // 负载分布
  IDLE_RESOURCE_COUNT: 'org_respool_idle_resources',
  NORMAL_LOAD_RESOURCE_COUNT: 'org_respool_normal_load_resources',
  HIGH_LOAD_RESOURCE_COUNT: 'org_respool_high_load_resources',
  OVERLOADED_RESOURCE_COUNT: 'org_respool_overloaded_resources',

  // 技能与需求
  SKILL_COVERAGE_COUNT: 'org_respool_skill_coverage_count',
  DEMAND_GAP_COUNT: 'org_respool_demand_gap_count',
  CONFLICT_COUNT: 'org_respool_conflict_count',
} as const

export type OrganizationResourcePoolMetricKey =
  (typeof ORGANIZATION_RESOURCE_POOL_METRIC_KEYS)[keyof typeof ORGANIZATION_RESOURCE_POOL_METRIC_KEYS]

export const ORGANIZATION_RESOURCE_POOL_METRIC_KEY_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_METRIC_KEYS,
) as readonly OrganizationResourcePoolMetricKey[]

// ─── Source Keys ──────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_SOURCES = {
  RESOURCE_REGISTRY: 'resource_registry',
  RESOURCE_ALLOCATION: 'resource_allocation',
  RESOURCE_REQUIREMENT: 'resource_requirement',
  RESOURCE_AVAILABILITY: 'resource_availability',
  PROJECT: 'project',
  PMO_DASHBOARD: 'pmo_dashboard',
  PROJECT_DASHBOARD: 'project_dashboard',
  COMPUTED: 'computed',
  MEMBERSHIP: 'membership',
} as const

export type OrganizationResourcePoolSource =
  (typeof ORGANIZATION_RESOURCE_POOL_SOURCES)[keyof typeof ORGANIZATION_RESOURCE_POOL_SOURCES]

export const ORGANIZATION_RESOURCE_POOL_SOURCE_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_SOURCES,
) as readonly OrganizationResourcePoolSource[]

// ─── Load Statuses ────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES = {
  IDLE: 'idle',
  NORMAL: 'normal',
  HIGH: 'high',
  OVERLOADED: 'overloaded',
  UNAVAILABLE: 'unavailable',
} as const

export type OrganizationResourcePoolLoadStatus =
  (typeof ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES)[keyof typeof ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES]

export const ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES,
) as readonly OrganizationResourcePoolLoadStatus[]

// ─── Conflict Severities ─────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
} as const

export type OrganizationResourcePoolConflictSeverity =
  (typeof ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES)[keyof typeof ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES]

export const ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES,
) as readonly OrganizationResourcePoolConflictSeverity[]

// ─── Warning Codes ───────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_WARNING_CODES = {
  EMPTY_ORGANIZATION_RESOURCE_POOL: 'EMPTY_ORGANIZATION_RESOURCE_POOL',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_PARTIAL: 'SOURCE_PARTIAL',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  LOW_CARDINALITY_REDACTED: 'LOW_CARDINALITY_REDACTED',
  DEPARTMENT_SOURCE_UNAVAILABLE: 'DEPARTMENT_SOURCE_UNAVAILABLE',
  CROSS_PROJECT_CONTENTION_REDACTED: 'CROSS_PROJECT_CONTENTION_REDACTED',
  DRILL_DOWN_FORBIDDEN: 'DRILL_DOWN_FORBIDDEN',
} as const

export type OrganizationResourcePoolWarningCode =
  (typeof ORGANIZATION_RESOURCE_POOL_WARNING_CODES)[keyof typeof ORGANIZATION_RESOURCE_POOL_WARNING_CODES]

export const ORGANIZATION_RESOURCE_POOL_WARNING_CODE_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_WARNING_CODES,
) as readonly OrganizationResourcePoolWarningCode[]

// ─── View Modes ──────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_VIEW_MODES = {
  MATRIX: 'matrix',
  LIST: 'list',
  SKILLS: 'skills',
  CONFLICTS: 'conflicts',
  DEMAND_GAPS: 'demand_gaps',
  TREND: 'trend',
} as const

export type OrganizationResourcePoolViewMode =
  (typeof ORGANIZATION_RESOURCE_POOL_VIEW_MODES)[keyof typeof ORGANIZATION_RESOURCE_POOL_VIEW_MODES]

export const ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_VIEW_MODES,
) as readonly OrganizationResourcePoolViewMode[]

// ─── Sort Keys ───────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_SORT_KEYS = {
  NAME: 'name',
  ROLE: 'role',
  UTILIZATION: 'utilization',
  CAPACITY: 'capacity',
  ALLOCATED: 'allocated',
  REMAINING: 'remaining',
  LOAD_STATUS: 'load_status',
  UPDATED_AT: 'updated_at',
} as const

export type OrganizationResourcePoolSortKey =
  (typeof ORGANIZATION_RESOURCE_POOL_SORT_KEYS)[keyof typeof ORGANIZATION_RESOURCE_POOL_SORT_KEYS]

export const ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_SORT_KEYS,
) as readonly OrganizationResourcePoolSortKey[]

// ─── Filter Types ────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES = {
  HUMAN: 'human',
  MATERIAL: 'material',
  EQUIPMENT: 'equipment',
} as const

export type OrganizationResourcePoolResourceType =
  (typeof ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES)[keyof typeof ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES]

// ─── Drill-Down Target Types ─────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_TARGET_KINDS = {
  PROJECT: 'project',
  RESOURCE: 'resource',
  TASK: 'task',
  SKILL: 'skill',
  CONFLICT: 'conflict',
  DEMAND_GAP: 'demand_gap',
} as const

export type OrganizationResourcePoolTargetKind =
  (typeof ORGANIZATION_RESOURCE_POOL_TARGET_KINDS)[keyof typeof ORGANIZATION_RESOURCE_POOL_TARGET_KINDS]

export const ORGANIZATION_RESOURCE_POOL_TARGET_KIND_VALUES = Object.values(
  ORGANIZATION_RESOURCE_POOL_TARGET_KINDS,
) as readonly OrganizationResourcePoolTargetKind[]

// ─── Statuses ────────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_STATUSES = {
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  REDACTED: 'redacted',
  STALE: 'stale',
  UNSUPPORTED: 'unsupported',
} as const

export type OrganizationResourcePoolStatus =
  (typeof ORGANIZATION_RESOURCE_POOL_STATUSES)[keyof typeof ORGANIZATION_RESOURCE_POOL_STATUSES]

// ─── Constants ───────────────────────────────────────────────────────────────

export const ORGANIZATION_RESOURCE_POOL_METRIC_VERSION = 'organization-resource-pool.v1' as const
export const ORGANIZATION_RESOURCE_POOL_DEFAULT_PAGE = 1
export const ORGANIZATION_RESOURCE_POOL_DEFAULT_PER_PAGE = 20
export const ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE = 100
export const ORGANIZATION_RESOURCE_POOL_MAX_TOP_N = 50
export const ORGANIZATION_RESOURCE_POOL_DEFAULT_DATE_WINDOW_DAYS = 90
export const ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS = 366
export const ORGANIZATION_RESOURCE_POOL_STALE_THRESHOLD_MINUTES = 60
export const ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES = 1440
export const ORGANIZATION_RESOURCE_POOL_MAX_SEARCH_LENGTH = 200
export const ORGANIZATION_RESOURCE_POOL_LOW_CARDINALITY_THRESHOLD = 3
export const ORGANIZATION_RESOURCE_POOL_DEFAULT_OVERLOADED_THRESHOLD = 100
export const ORGANIZATION_RESOURCE_POOL_MAX_SCAN_PROJECTS = 2000

// ─── DTO: Warning ────────────────────────────────────────────────────────────

export interface OrganizationResourcePoolWarning {
  code: OrganizationResourcePoolWarningCode
  message: string
  metricKey?: OrganizationResourcePoolMetricKey
  source?: OrganizationResourcePoolSource
}

// ─── DTO: Freshness ──────────────────────────────────────────────────────────

export interface OrganizationResourcePoolSourceFreshness {
  source: OrganizationResourcePoolSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
  status: OrganizationResourcePoolStatus
}

// ─── DTO: Metric ─────────────────────────────────────────────────────────────

export interface OrganizationResourcePoolMetric {
  key: OrganizationResourcePoolMetricKey
  value: number | null
  unit: 'count' | 'percent' | 'hours'
  source: OrganizationResourcePoolSource
  status: OrganizationResourcePoolStatus
  warnings?: OrganizationResourcePoolWarning[]
}

// ─── DTO: Drill-Down Target ─────────────────────────────────────────────────

/**
 * 低敏 route descriptor。只描述「去哪里」，不含实体名称或证据文本；
 * authorized === false 的 target 后端不下发（返回 null），真实详情端点仍二次授权。
 */
export interface OrganizationResourcePoolTarget {
  kind: OrganizationResourcePoolTargetKind
  href: string
  authorized: boolean
}

// ─── DTO: Resource Row ──────────────────────────────────────────────────────

export interface OrganizationResourcePoolResourceRow {
  resourceId: number
  resourceName: string | null // null when redacted
  resourceType: OrganizationResourcePoolResourceType | null
  role: string | null
  status: string | null
  skillTags: string[] | null
  department: string | null
  linkedUserId: number | null // null when unauthorized
  projectCount: number | null
  totalCapacityHours: number
  totalAllocatedHours: number
  totalRemainingHours: number
  utilizationPercent: number
  loadStatus: OrganizationResourcePoolLoadStatus
  conflictFlags: OrganizationResourcePoolConflictSeverity[]
  freshness: OrganizationResourcePoolSourceFreshness | null
  target: OrganizationResourcePoolTarget | null
  redacted: boolean
}

// ─── DTO: Capacity Matrix ───────────────────────────────────────────────────

export interface OrganizationResourcePoolCapacityCell {
  date: string
  capacityHours: number
  allocatedHours: number
  remainingHours: number
  utilizationPercent: number
  loadStatus: OrganizationResourcePoolLoadStatus
  conflictFlags: OrganizationResourcePoolConflictSeverity[]
}

export interface OrganizationResourcePoolCapacityMatrixRow {
  resourceId: number
  resourceName: string | null
  role: string | null
  loadStatus: OrganizationResourcePoolLoadStatus
  totalCapacityHours: number
  totalAllocatedHours: number
  totalRemainingHours: number
  utilizationPercent: number
  cells: OrganizationResourcePoolCapacityCell[]
  redacted: boolean
}

export interface OrganizationResourcePoolCapacityMatrix {
  from: string
  to: string
  rows: OrganizationResourcePoolCapacityMatrixRow[]
}

// ─── DTO: Skill Coverage ────────────────────────────────────────────────────

export interface OrganizationResourcePoolSkillItem {
  skill: string | null // null when redacted
  resourceCount: number | null
  capacityHours: number | null
  allocatedHours: number | null
  remainingHours: number | null
  demandCount: number | null
  gap: boolean
  redacted: boolean
}

// ─── DTO: Conflict ──────────────────────────────────────────────────────────

export interface OrganizationResourcePoolConflict {
  conflictId: string // stable hash-based id
  severity: OrganizationResourcePoolConflictSeverity
  resourceId: number | null
  resourceName: string | null
  projectIds: number[] | null
  projectNames: string[] | null
  description: string
  date: string | null
  remediationHint: string | null
  target: OrganizationResourcePoolTarget | null
  redacted: boolean
}

// ─── DTO: Demand Gap ────────────────────────────────────────────────────────

export interface OrganizationResourcePoolDemandGap {
  gapId: string
  skill: string | null
  role: string | null
  projectId: number | null
  projectName: string | null
  taskId: number | null
  dateWindow: { from: string; to: string } | null
  priority: string | null
  target: OrganizationResourcePoolTarget | null
  redacted: boolean
  /** v3-resource-gap-analysis 统一缺口引用（能力可用时填充） */
  gapAnalysisRef?: {
    metricVersion: string
    reasonCodes: string[]
    severity: string
    evidenceHashes: string[]
  }
}

// ─── DTO: Summary ───────────────────────────────────────────────────────────

export interface OrganizationResourcePoolMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  visibleProjectCount: number
  querySignatureHash: string
}

export interface OrganizationResourcePoolSummary {
  meta: OrganizationResourcePoolMeta
  metrics: OrganizationResourcePoolMetric[]
  warnings: OrganizationResourcePoolWarning[]
  sourceFreshness: OrganizationResourcePoolSourceFreshness[]
  resourceCount: number
  linkedUserCount: number | null // null when unauthorized
  capacity: {
    totalHours: number
    allocatedHours: number
    remainingHours: number
    averageUtilizationPercent: number
  }
  loadDistribution: Record<OrganizationResourcePoolLoadStatus, number>
  skillCoverage: OrganizationResourcePoolSkillItem[]
  demandGapCount: number
  conflictCount: number
}

// ─── DTO: Query ─────────────────────────────────────────────────────────────

export interface OrganizationResourcePoolQuery {
  from?: string
  to?: string
  view?: OrganizationResourcePoolViewMode
  resourceType?: OrganizationResourcePoolResourceType
  role?: string
  skill?: string
  department?: string
  loadStatus?: OrganizationResourcePoolLoadStatus
  conflictSeverity?: OrganizationResourcePoolConflictSeverity
  projectIds?: number[]
  search?: string
  sort?: OrganizationResourcePoolSortKey
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
  topN?: number
  freshnessWindowMinutes?: number
}

export interface NormalizedOrganizationResourcePoolQuery {
  from: string | null
  to: string | null
  view: OrganizationResourcePoolViewMode
  resourceType: OrganizationResourcePoolResourceType | null
  role: string | null
  skill: string | null
  department: string | null
  loadStatus: OrganizationResourcePoolLoadStatus | null
  conflictSeverity: OrganizationResourcePoolConflictSeverity | null
  projectIds: number[] | null
  search: string | null
  sort: OrganizationResourcePoolSortKey
  order: 'asc' | 'desc'
  page: number
  perPage: number
  topN: number
  freshnessWindowMinutes: number
}

export interface OrganizationResourcePoolValidationDetail {
  allowedViews: readonly OrganizationResourcePoolViewMode[]
  allowedSorts: readonly OrganizationResourcePoolSortKey[]
  allowedLoadStatuses: readonly OrganizationResourcePoolLoadStatus[]
  allowedSeverities: readonly OrganizationResourcePoolConflictSeverity[]
  maxDateWindowDays: number
  maxPerPage: number
  maxTopN: number
  maxFreshnessWindowMinutes: number
}

// ─── DTO: Audit ─────────────────────────────────────────────────────────────

export interface OrganizationResourcePoolReadAudit {
  actorId: number
  organizationId: number
  endpointFamily: string
  querySignatureHash: string
  metricKeys: OrganizationResourcePoolMetricKey[]
  warningCodes: OrganizationResourcePoolWarningCode[]
  sourceFreshnessHash: string
  occurredAt: string
}

// ─── DTO: Response Envelopes ────────────────────────────────────────────────

export interface OrganizationResourcePoolEnvelope<T> {
  data: T
  meta: {
    total?: number
    page?: number
    perPage?: number
    totalPages?: number
  }
}

// ─── Pure Helpers ───────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** 稳定 FNV-1a 哈希——用于 input signature 与 freshness 指纹，不含敏感原文。 */
export function organizationResourcePoolStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 归一化查询：view 白名单、date window clamp、分页 clamp、search 截断。 */
export function normalizeOrganizationResourcePoolQuery(
  query: OrganizationResourcePoolQuery = {},
): NormalizedOrganizationResourcePoolQuery {
  const search = query.search?.trim().slice(0, ORGANIZATION_RESOURCE_POOL_MAX_SEARCH_LENGTH)
  const from = query.from ?? null
  const to = query.to ?? null

  // Clamp date window
  let resolvedFrom = from
  let resolvedTo = to
  if (from && to) {
    const fromMs = new Date(from).getTime()
    const toMs = new Date(to).getTime()
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24)
      if (diffDays > ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS) {
        // Clamp to window from the `from` date
        resolvedTo = new Date(
          fromMs + ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
      }
    }
  }

  return {
    from: resolvedFrom,
    to: resolvedTo,
    view:
      query.view && ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES.includes(query.view)
        ? query.view
        : ORGANIZATION_RESOURCE_POOL_VIEW_MODES.MATRIX,
    resourceType: query.resourceType ?? null,
    role: query.role?.trim() || null,
    skill: query.skill?.trim() || null,
    department: query.department?.trim() || null,
    loadStatus:
      query.loadStatus && ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES.includes(query.loadStatus)
        ? query.loadStatus
        : null,
    conflictSeverity:
      query.conflictSeverity &&
      ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES.includes(query.conflictSeverity)
        ? query.conflictSeverity
        : null,
    projectIds: query.projectIds?.length
      ? query.projectIds.map(Number).filter((n) => Number.isFinite(n))
      : null,
    search: search ?? null,
    sort:
      query.sort && ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES.includes(query.sort)
        ? query.sort
        : ORGANIZATION_RESOURCE_POOL_SORT_KEYS.UTILIZATION,
    order: query.order === 'asc' ? 'asc' : 'desc',
    page: clamp(query.page ?? ORGANIZATION_RESOURCE_POOL_DEFAULT_PAGE, 1, 10_000),
    perPage: clamp(
      query.perPage ?? ORGANIZATION_RESOURCE_POOL_DEFAULT_PER_PAGE,
      1,
      ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE,
    ),
    topN: clamp(
      query.topN ?? ORGANIZATION_RESOURCE_POOL_MAX_TOP_N,
      1,
      ORGANIZATION_RESOURCE_POOL_MAX_TOP_N,
    ),
    freshnessWindowMinutes: clamp(
      query.freshnessWindowMinutes ?? ORGANIZATION_RESOURCE_POOL_STALE_THRESHOLD_MINUTES,
      1,
      ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES,
    ),
  }
}

export function organizationResourcePoolValidationDetail(): OrganizationResourcePoolValidationDetail {
  return {
    allowedViews: ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES,
    allowedSorts: ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES,
    allowedLoadStatuses: ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES,
    allowedSeverities: ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES,
    maxDateWindowDays: ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS,
    maxPerPage: ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE,
    maxTopN: ORGANIZATION_RESOURCE_POOL_MAX_TOP_N,
    maxFreshnessWindowMinutes: ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES,
  }
}

// ─── Load Bucket Mapping ────────────────────────────────────────────────────

export function mapLoadBucket(utilizationPercent: number): OrganizationResourcePoolLoadStatus {
  if (utilizationPercent < 0) return ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.UNAVAILABLE
  if (utilizationPercent <= 10) return ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.IDLE
  if (utilizationPercent <= 80) return ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL
  if (utilizationPercent <= 100) return ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.HIGH
  return ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.OVERLOADED
}

// ─── Low-Cardinality Redaction ──────────────────────────────────────────────

export function isLowCardinalityBucket(
  count: number,
  threshold: number = ORGANIZATION_RESOURCE_POOL_LOW_CARDINALITY_THRESHOLD,
): boolean {
  return count > 0 && count < threshold
}

// ─── Freshness Helpers ──────────────────────────────────────────────────────

export function isOrganizationResourcePoolSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number = ORGANIZATION_RESOURCE_POOL_STALE_THRESHOLD_MINUTES,
  now: number = Date.now(),
): boolean {
  if (!lastUpdatedAt) return true
  const last = new Date(lastUpdatedAt).getTime()
  if (!Number.isFinite(last)) return true
  return now - last > thresholdMinutes * 60 * 1000
}

export function makeOrganizationResourcePoolFreshness(input: {
  source: OrganizationResourcePoolSource
  lastUpdatedAt: string | null
  staleThresholdMinutes?: number
  forbidden?: boolean
  unavailable?: boolean
  now?: number
}): OrganizationResourcePoolSourceFreshness {
  const staleThresholdMinutes =
    input.staleThresholdMinutes ?? ORGANIZATION_RESOURCE_POOL_STALE_THRESHOLD_MINUTES
  if (input.forbidden) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
    }
  }
  if (input.unavailable) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: ORGANIZATION_RESOURCE_POOL_STATUSES.UNAVAILABLE,
    }
  }
  const isStale = isOrganizationResourcePoolSourceStale(
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
      ? ORGANIZATION_RESOURCE_POOL_STATUSES.STALE
      : ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
  }
}

export function organizationResourcePoolFreshnessHash(
  freshness: OrganizationResourcePoolSourceFreshness,
): string {
  return organizationResourcePoolStableHash(
    `${freshness.source}:${freshness.lastUpdatedAt ?? 'none'}:${freshness.status}`,
  )
}

/** 合并多个 freshness 条目：取最晚更新时间、任一 stale 即 stale。 */
export function mergeOrganizationResourcePoolFreshness(
  items: OrganizationResourcePoolSourceFreshness[],
): OrganizationResourcePoolSourceFreshness | null {
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
      curr.status === ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN ||
      curr.status === ORGANIZATION_RESOURCE_POOL_STATUSES.UNAVAILABLE
    ) {
      worstStatus = curr.status
    }
  }
  return {
    source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
    lastUpdatedAt: latest,
    isStale: anyStale,
    staleThresholdMinutes: first.staleThresholdMinutes,
    status:
      worstStatus === ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN
        ? worstStatus
        : anyStale
          ? ORGANIZATION_RESOURCE_POOL_STATUSES.STALE
          : ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
  }
}

// ─── Warning Helpers ─────────────────────────────────────────────────────────

export function mergeOrganizationResourcePoolWarnings(
  ...groups: Array<OrganizationResourcePoolWarning[] | undefined>
): OrganizationResourcePoolWarning[] {
  const seen = new Set<string>()
  const merged: OrganizationResourcePoolWarning[] = []
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

// ─── Source Signature Helpers ────────────────────────────────────────────────

export function computeSourceSignature(values: string[]): string {
  return organizationResourcePoolStableHash(values.join(':'))
}

/** 容量聚合归一化——确保小时数非负且精度≤2 位小数。 */
export function normalizeCapacityHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) return 0
  return Math.round(hours * 100) / 100
}

/** 利用率归一化——0–100 百分比，最多 1 位小数。 */
export function normalizeUtilizationPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return 0
  return Math.round(Math.min(percent, 100) * 10) / 10
}

// ─── Drill-Down Hash ────────────────────────────────────────────────────────

export function computeDrillDownBucketHash(input: {
  kind: OrganizationResourcePoolTargetKind
  organizationId: number
  resourceId?: number | null
  projectId?: number | null
  taskId?: number | null
  skill?: string | null
  conflictId?: string | null
  gapId?: string | null
}): string {
  return organizationResourcePoolStableHash(
    `${input.kind}:${input.organizationId}:${input.resourceId ?? ''}:${input.projectId ?? ''}:${input.taskId ?? ''}:${input.skill ?? ''}:${input.conflictId ?? ''}:${input.gapId ?? ''}`,
  )
}
