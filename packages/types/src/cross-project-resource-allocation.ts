// @aiproj/types —— 跨项目资源分配共享契约（前后端共享）。
// v3-cross-project-resource-allocation §2：DTO、枚举、常量、warning、redaction、
// freshness、evidence、draft item、preview、confirmation、apply result 与纯函数助手。
//
// 红线：
//   - 共享包零运行时依赖，不含 AdonisJS/React/数据库/AI/缓存/网络导入。
//   - 草案只是组织级编排层，正式写入必须在项目本地完成，不创建跨项目单项分配事实。
//   - AI 建议 = advisoryOnly + confirmationRequired + applied=false；失败不阻塞规则/手动流程。
//   - 权限脱敏只返回低敏 warning code + 可见范围计数，不暴露隐藏名称/证据文本。
//   - 不为任务 assignee 创建需求/分配推导口径。

// ─── Draft Status ──────────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_DRAFT_STATUSES = {
  DRAFT: 'draft',
  PREVIEWED: 'previewed',
  CONFIRMED: 'confirmed',
  APPLIED: 'applied',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
} as const

export type CrossProjectAllocationDraftStatus =
  (typeof CROSS_PROJECT_ALLOCATION_DRAFT_STATUSES)[keyof typeof CROSS_PROJECT_ALLOCATION_DRAFT_STATUSES]

export const CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_DRAFT_STATUSES,
) as readonly CrossProjectAllocationDraftStatus[]

// ─── Allocation Item Type ──────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_ITEM_TYPES = {
  ALLOCATE: 'allocate',
  REALLOCATE: 'reallocate',
  REMOVE: 'remove',
  MAP_RESOURCE: 'map_resource',
} as const

export type CrossProjectAllocationItemType =
  (typeof CROSS_PROJECT_ALLOCATION_ITEM_TYPES)[keyof typeof CROSS_PROJECT_ALLOCATION_ITEM_TYPES]

export const CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_ITEM_TYPES,
) as readonly CrossProjectAllocationItemType[]

// ─── Candidate Source ──────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES = {
  RULE: 'rule',
  AI: 'ai',
  MANUAL: 'manual',
  IMPORTED: 'imported',
} as const

export type CrossProjectAllocationCandidateSource =
  (typeof CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES)[keyof typeof CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES]

export const CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCE_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_CANDIDATE_SOURCES,
) as readonly CrossProjectAllocationCandidateSource[]

// ─── Conflict Severity ─────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITIES = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
} as const

export type CrossProjectAllocationConflictSeverity =
  (typeof CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITIES)[keyof typeof CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITIES]

export const CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITIES,
) as readonly CrossProjectAllocationConflictSeverity[]

// ordered: more severe = higher number
export const CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_ORDER: Record<
  CrossProjectAllocationConflictSeverity,
  number
> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
}

// ─── Item Status ───────────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_ITEM_STATUSES = {
  PENDING: 'pending',
  CONFLICT: 'conflict',
  READY: 'ready',
  APPLIED: 'applied',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const

export type CrossProjectAllocationItemStatus =
  (typeof CROSS_PROJECT_ALLOCATION_ITEM_STATUSES)[keyof typeof CROSS_PROJECT_ALLOCATION_ITEM_STATUSES]

export const CROSS_PROJECT_ALLOCATION_ITEM_STATUS_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_ITEM_STATUSES,
) as readonly CrossProjectAllocationItemStatus[]

// ─── Apply Result Status ───────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
  STALE: 'stale',
} as const

export type CrossProjectAllocationApplyResultStatus =
  (typeof CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES)[keyof typeof CROSS_PROJECT_ALLOCATION_APPLY_RESULT_STATUSES]

// ─── Warning Codes ─────────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_WARNING_CODES = {
  EMPTY_ORGANIZATION: 'EMPTY_ORGANIZATION',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_PARTIAL: 'SOURCE_PARTIAL',
  OVERLOADED_CANDIDATE: 'OVERLOADED_CANDIDATE',
  SKILL_GAP: 'SKILL_GAP',
  UNAVAILABLE_DATE: 'UNAVAILABLE_DATE',
  CANDIDATE_UNAVAILABLE: 'CANDIDATE_UNAVAILABLE',
  CONFLICT_OVERLAP: 'CONFLICT_OVERLAP',
  NO_CANDIDATES: 'NO_CANDIDATES',
  TARGET_PERMISSION_REVOKED: 'TARGET_PERMISSION_REVOKED',
  TARGET_PROJECT_HIDDEN: 'TARGET_PROJECT_HIDDEN',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  DRILL_DOWN_FORBIDDEN: 'DRILL_DOWN_FORBIDDEN',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  LOW_CARDINALITY_REDACTED: 'LOW_CARDINALITY_REDACTED',
} as const

export type CrossProjectAllocationWarningCode =
  (typeof CROSS_PROJECT_ALLOCATION_WARNING_CODES)[keyof typeof CROSS_PROJECT_ALLOCATION_WARNING_CODES]

export const CROSS_PROJECT_ALLOCATION_WARNING_CODE_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_WARNING_CODES,
) as readonly CrossProjectAllocationWarningCode[]

// ─── Redaction State ───────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_REDACTION_STATES = {
  VISIBLE: 'visible',
  REDACTED: 'redacted',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
} as const

export type CrossProjectAllocationRedactionState =
  (typeof CROSS_PROJECT_ALLOCATION_REDACTION_STATES)[keyof typeof CROSS_PROJECT_ALLOCATION_REDACTION_STATES]

export const CROSS_PROJECT_ALLOCATION_REDACTION_STATE_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_REDACTION_STATES,
) as readonly CrossProjectAllocationRedactionState[]

// ─── Sort Keys ─────────────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_SORT_KEYS = {
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  STATUS: 'status',
  TARGET_PROJECT: 'target_project',
  ITEM_STATUS: 'item_status',
  CONFLICT_SEVERITY: 'conflict_severity',
} as const

export type CrossProjectAllocationSortKey =
  (typeof CROSS_PROJECT_ALLOCATION_SORT_KEYS)[keyof typeof CROSS_PROJECT_ALLOCATION_SORT_KEYS]

export const CROSS_PROJECT_ALLOCATION_SORT_KEY_VALUES = Object.values(
  CROSS_PROJECT_ALLOCATION_SORT_KEYS,
) as readonly CrossProjectAllocationSortKey[]

// ─── Drill-Down Target Kinds ───────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_TARGET_KINDS = {
  PROJECT: 'project',
  TASK: 'task',
  RESOURCE: 'resource',
  ALLOCATION: 'allocation',
  CONFLICT: 'conflict',
  EVIDENCE: 'evidence',
} as const

export type CrossProjectAllocationTargetKind =
  (typeof CROSS_PROJECT_ALLOCATION_TARGET_KINDS)[keyof typeof CROSS_PROJECT_ALLOCATION_TARGET_KINDS]

// ─── Constants ─────────────────────────────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_SCHEMA_VERSION = 'cross-project-allocation.v1' as const
export const CROSS_PROJECT_ALLOCATION_DEFAULT_PAGE = 1
export const CROSS_PROJECT_ALLOCATION_DEFAULT_PER_PAGE = 20
export const CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE = 100
export const CROSS_PROJECT_ALLOCATION_MAX_TOP_N = 50
export const CROSS_PROJECT_ALLOCATION_DEFAULT_DATE_WINDOW_DAYS = 90
export const CROSS_PROJECT_ALLOCATION_MAX_DATE_WINDOW_DAYS = 366
export const CROSS_PROJECT_ALLOCATION_STALE_THRESHOLD_MINUTES = 60
export const CROSS_PROJECT_ALLOCATION_PREVIEW_EXPIRATION_MINUTES = 30
export const CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE = 50
export const CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH = 200
export const CROSS_PROJECT_ALLOCATION_IDEMPOTENCY_KEY_MAX_LENGTH = 128
export const CROSS_PROJECT_ALLOCATION_HASH_ALGORITHM = 'sha256' as const

// ─── DTO: Warning ──────────────────────────────────────────────────────────────

export interface CrossProjectAllocationWarning {
  code: CrossProjectAllocationWarningCode
  message: string
  severity: CrossProjectAllocationConflictSeverity
  source?: string
  visibleCount?: number
  redactedCount?: number
}

// ─── DTO: Freshness ────────────────────────────────────────────────────────────

export interface CrossProjectAllocationSourceFreshness {
  source: string
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
  sourceSignature: string | null
}

// ─── DTO: Evidence ─────────────────────────────────────────────────────────────

export interface CrossProjectAllocationEvidenceRef {
  kind: CrossProjectAllocationTargetKind
  id: number | string
  label: string
  redaction: CrossProjectAllocationRedactionState
}

export interface CrossProjectAllocationEvidence {
  references: CrossProjectAllocationEvidenceRef[]
  sourceSignatures: Record<string, string>
  freshness: CrossProjectAllocationSourceFreshness[]
  warnings: CrossProjectAllocationWarning[]
  evidenceHash: string
  computedAt: string
}

// ─── DTO: Candidate Resource ───────────────────────────────────────────────────

export interface CrossProjectAllocationCandidateResource {
  resourceId: number
  resourceName: string
  redaction: CrossProjectAllocationRedactionState
  sourceProjectId: number
  sourceProjectName: string
  remainingCapacityHours: number
  dailyCapacityHours: number
  skillTags: string[]
  skillFitPercent: number
  availabilitySlots: Array<{ startDate: string; endDate: string }>
  unavailableDates: string[]
  currentUtilizationPercent: number
  afterAllocationUtilizationPercent: number | null
  pmoPriorityScore: number | null
  source: CrossProjectAllocationCandidateSource
  rationale: string | null
}

// ─── DTO: Demand Item ──────────────────────────────────────────────────────────

export interface CrossProjectAllocationDemand {
  id: string
  targetProjectId: number
  targetProjectName: string
  targetTaskId: number | null
  targetTaskName: string | null
  requiredSkillTags: string[]
  requiredHours: number
  requiredRole: string | null
  startDate: string
  endDate: string
  priority: number | null
  currentAllocationPercent: number
}

// ─── DTO: Draft Item ───────────────────────────────────────────────────────────

export interface CrossProjectAllocationDraftItem {
  id: string
  itemType: CrossProjectAllocationItemType
  status: CrossProjectAllocationItemStatus
  demand: CrossProjectAllocationDemand
  candidate: CrossProjectAllocationCandidateResource | null
  allocationPercent: number
  startDate: string
  endDate: string
  conflicts: CrossProjectAllocationConflict[]
  source: CrossProjectAllocationCandidateSource
  advisoryOnly: boolean
  confirmationRequired: boolean
  applied: boolean
  createdAt: string
  updatedAt: string
}

// ─── DTO: Conflict ─────────────────────────────────────────────────────────────

export interface CrossProjectAllocationConflict {
  severity: CrossProjectAllocationConflictSeverity
  code: CrossProjectAllocationWarningCode
  message: string
  affectedDates: string[]
  affectedProjectIds: number[]
  redaction: CrossProjectAllocationRedactionState
}

// ─── DTO: Preview ──────────────────────────────────────────────────────────────

export interface CrossProjectAllocationPreview {
  draftId: string
  status: CrossProjectAllocationDraftStatus
  items: CrossProjectAllocationDraftItem[]
  conflicts: CrossProjectAllocationConflict[]
  affectedVisibleProjects: Array<{
    projectId: number
    projectName: string
    redaction: CrossProjectAllocationRedactionState
  }>
  evidence: CrossProjectAllocationEvidence
  previewHash: string
  previewExpiresAt: string
  warnings: CrossProjectAllocationWarning[]
}

// ─── DTO: Confirmation Snapshot ────────────────────────────────────────────────

export interface CrossProjectAllocationConfirmation {
  id: string
  draftId: string
  actorId: number
  organizationId: number
  visibleTargetProjectIds: number[]
  itemIds: string[]
  previewHash: string
  queryShape: CrossProjectAllocationQueryShape
  warnings: CrossProjectAllocationWarning[]
  idempotencyKeyHash: string
  confirmedAt: string
}

// ─── DTO: Apply Result ─────────────────────────────────────────────────────────

export interface CrossProjectAllocationApplyResult {
  status: CrossProjectAllocationApplyResultStatus
  draftId: string
  confirmationId: string
  itemResults: Array<{
    itemId: string
    status: CrossProjectAllocationItemStatus
    targetProjectId: number
    targetAllocationId: number | null
    errorCode: string | null
  }>
  idempotencyKeyHash: string
  appliedAt: string
  warnings: CrossProjectAllocationWarning[]
}

// ─── DTO: Audit Summary ────────────────────────────────────────────────────────

export interface CrossProjectAllocationAuditSummary {
  actorId: number
  organizationId: number
  endpointFamily: string
  queryShapeHash: string | null
  visibleProjectIdsHash: string | null
  itemIdsHash: string | null
  metricKeys: string[]
  warningCodes: CrossProjectAllocationWarningCode[]
  sourceFreshnessHash: string | null
  idempotencyKeyHash: string | null
  status: string
  timestamp: string
  correlationId: string | null
}

// ─── DTO: Draft ────────────────────────────────────────────────────────────────

export interface CrossProjectAllocationDraft {
  id: string
  organizationId: number
  status: CrossProjectAllocationDraftStatus
  name: string
  queryShape: CrossProjectAllocationQueryShape
  itemCount: number
  evidence: CrossProjectAllocationEvidence | null
  previewHash: string | null
  previewExpiresAt: string | null
  warnings: CrossProjectAllocationWarning[]
  createdAt: string
  updatedAt: string
}

// ─── DTO: Draft Detail ─────────────────────────────────────────────────────────

export interface CrossProjectAllocationDraftDetail extends CrossProjectAllocationDraft {
  items: CrossProjectAllocationDraftItem[]
  confirmation: CrossProjectAllocationConfirmation | null
  applyResult: CrossProjectAllocationApplyResult | null
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export interface CrossProjectAllocationQueryShape {
  organizationId: number
  projectIds: number[]
  dateWindow: { from: string; to: string }
  resourceTypes: string[]
  roles: string[]
  skillTags: string[]
  departments: string[]
  loadStatuses: string[]
  conflictSeverities: CrossProjectAllocationConflictSeverity[]
  draftStatuses: CrossProjectAllocationDraftStatus[]
  search: string | null
  sort: CrossProjectAllocationSortKey
  sortDir: 'asc' | 'desc'
  page: number
  perPage: number
  topN: number
  freshnessThresholdMinutes: number
}

// ─── API Envelope ──────────────────────────────────────────────────────────────

export interface CrossProjectAllocationListResponse {
  data: CrossProjectAllocationDraft[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface CrossProjectAllocationCandidatesResponse {
  data: CrossProjectAllocationCandidateResource[]
  meta: {
    total: number
    topN: number
    hasMore: boolean
  }
}

export interface CrossProjectAllocationDrillDownResponse {
  targetKind: CrossProjectAllocationTargetKind
  targetId: number | string
  data: Record<string, unknown>
  evidence: CrossProjectAllocationEvidence | null
}

// ─── Draft Allocation Percent Bounds ───────────────────────────────────────────

export const CROSS_PROJECT_ALLOCATION_MIN_PERCENT = 0
export const CROSS_PROJECT_ALLOCATION_MAX_PERCENT = 100
