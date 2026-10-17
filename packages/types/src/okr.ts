// @aiproj/types —— OKR 层级管理共享契约（前后端共享）。
// v3-okr-hierarchy-management §2：DTO、枚举、常量、warning code、rollup helper、alignment 校验。
//
// 红线：
//   - OKR 作为组织级一等模型，组织隔离以 organization_id 为硬过滤。
//   - AI 只生成待审草案/建议，任何写入必须经 Policy/RBAC、组织隔离、预览/差异、人工确认与审计。
//   - 项目/任务只作证据引用，不隐式回填 KR 当前值。
//   - currency_like 仅作业务数值标签，不进入财务核算。
//   - 跨组织访问不得泄露目标存在性。

// ─── Measurement Types ────────────────────────────────────────────────────────

export const OKR_MEASUREMENT_TYPES = {
  NUMBER: 'number',
  PERCENT: 'percent',
  CURRENCY_LIKE: 'currency_like',
  MILESTONE: 'milestone',
  BINARY: 'binary',
} as const

export type OkrMeasurementType = (typeof OKR_MEASUREMENT_TYPES)[keyof typeof OKR_MEASUREMENT_TYPES]

export const OKR_MEASUREMENT_TYPE_VALUES = Object.values(
  OKR_MEASUREMENT_TYPES,
) as readonly OkrMeasurementType[]

/** measurement type 的允许数值范围 */
export const OKR_MEASUREMENT_BOUNDS: Record<OkrMeasurementType, { min: number; max: number }> = {
  number: { min: 0, max: Number.MAX_SAFE_INTEGER },
  percent: { min: 0, max: 100 },
  currency_like: { min: 0, max: Number.MAX_SAFE_INTEGER },
  milestone: { min: 0, max: 1 },
  binary: { min: 0, max: 1 },
}

// ─── OKR Scopes ──────────────────────────────────────────────────────────────

export const OKR_SCOPES = {
  ORGANIZATION: 'organization',
  TEAM: 'team',
  PROJECT: 'project',
  INDIVIDUAL: 'individual',
} as const

export type OkrScope = (typeof OKR_SCOPES)[keyof typeof OKR_SCOPES]

export const OKR_SCOPE_VALUES = Object.values(OKR_SCOPES) as readonly OkrScope[]

/** individual scope 默认禁用写入（D1 / Open Questions） */
export const OKR_DISABLED_SCOPES: readonly OkrScope[] = ['individual']

// ─── OKR Statuses ────────────────────────────────────────────────────────────

export const OKR_STATUSES = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const

export type OkrStatus = (typeof OKR_STATUSES)[keyof typeof OKR_STATUSES]

export const OKR_STATUS_VALUES = Object.values(OKR_STATUSES) as readonly OkrStatus[]

export const OKR_ACTIVE_STATUSES: readonly OkrStatus[] = ['draft', 'active', 'paused']

export const OKR_CLOSED_STATUSES: readonly OkrStatus[] = ['completed', 'archived']

// ─── KR Confidence ───────────────────────────────────────────────────────────

export const OKR_CONFIDENCE_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const

export type OkrConfidenceLevel = (typeof OKR_CONFIDENCE_LEVELS)[keyof typeof OKR_CONFIDENCE_LEVELS]

export const OKR_CONFIDENCE_LEVEL_VALUES = Object.values(
  OKR_CONFIDENCE_LEVELS,
) as readonly OkrConfidenceLevel[]

// ─── Evidence Source Kinds ──────────────────────────────────────────────────

export const OKR_EVIDENCE_SOURCE_KINDS = {
  PROJECT: 'project',
  MILESTONE: 'milestone',
  TASK: 'task',
  PMO: 'pmo',
  RESOURCE: 'resource',
  REPORT: 'report',
  AUDIT: 'audit',
} as const

export type OkrEvidenceSourceKind =
  (typeof OKR_EVIDENCE_SOURCE_KINDS)[keyof typeof OKR_EVIDENCE_SOURCE_KINDS]

export const OKR_EVIDENCE_SOURCE_KIND_VALUES = Object.values(
  OKR_EVIDENCE_SOURCE_KINDS,
) as readonly OkrEvidenceSourceKind[]

// ─── Warning Codes ───────────────────────────────────────────────────────────

export const OKR_WARNING_CODES = {
  EMPTY_OKR_RESULT: 'EMPTY_OKR_RESULT',
  EMPTY_KEY_RESULTS: 'EMPTY_KEY_RESULTS',
  RESTRICTED_CHILD: 'RESTRICTED_CHILD',
  STALE_EVIDENCE: 'STALE_EVIDENCE',
  EVIDENCE_UNAVAILABLE: 'EVIDENCE_UNAVAILABLE',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  MAX_DEPTH_EXCEEDED: 'MAX_DEPTH_EXCEEDED',
  DUPLICATE_ALIGNMENT: 'DUPLICATE_ALIGNMENT',
  DISABLED_SCOPE: 'DISABLED_SCOPE',
  CROSS_ORGANIZATION: 'CROSS_ORGANIZATION',
  INVALID_WEIGHT: 'INVALID_WEIGHT',
  INVALID_MEASUREMENT: 'INVALID_MEASUREMENT',
  AI_DRAFT_UNAVAILABLE: 'AI_DRAFT_UNAVAILABLE',
  AI_CONTEXT_RESTRICTED: 'AI_CONTEXT_RESTRICTED',
  LARGE_TREE_TRUNCATED: 'LARGE_TREE_TRUNCATED',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
} as const

export type OkrWarningCode = (typeof OKR_WARNING_CODES)[keyof typeof OKR_WARNING_CODES]

export const OKR_WARNING_CODE_VALUES = Object.values(OKR_WARNING_CODES) as readonly OkrWarningCode[]

// ─── Alignment Constraints ──────────────────────────────────────────────────

export const OKR_ALIGNMENT_CONSTRAINTS = {
  MAX_DEPTH: 5,
  MAX_CHILDREN_PER_OBJECTIVE: 100,
  MAX_PARENTS_PER_OBJECTIVE: 1,
} as const

// ─── Query / Sort / Filter Constants ────────────────────────────────────────

export const OKR_SORT_FIELDS = {
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  TITLE: 'title',
  STATUS: 'status',
  PROGRESS: 'progress',
  START_DATE: 'startDate',
  END_DATE: 'endDate',
  OWNER: 'owner',
} as const

export type OkrSortField = (typeof OKR_SORT_FIELDS)[keyof typeof OKR_SORT_FIELDS]

export const OKR_SORT_FIELD_VALUES = Object.values(OKR_SORT_FIELDS) as readonly OkrSortField[]

export const OKR_DEFAULT_SORT: OkrSortField = 'createdAt'

export const OKR_INCLUDE_OPTIONS = {
  CHILDREN: 'children',
  KEY_RESULTS: 'keyResults',
  EVIDENCE: 'evidence',
  ALIGNMENTS: 'alignments',
  PROGRESS_HISTORY: 'progressHistory',
  OWNER: 'owner',
} as const

export type OkrIncludeOption = (typeof OKR_INCLUDE_OPTIONS)[keyof typeof OKR_INCLUDE_OPTIONS]

export const OKR_INCLUDE_VALUES = Object.values(OKR_INCLUDE_OPTIONS) as readonly OkrIncludeOption[]

export const OKR_DEFAULT_PAGE_SIZE = 25
export const OKR_MAX_PAGE_SIZE = 100
export const OKR_MAX_DEPTH_QUERY = 5

// ─── Metric Version ─────────────────────────────────────────────────────────

export const OKR_METRIC_VERSION = '1.0.0'

// ─── Target Kinds (for evidence drill-down) ─────────────────────────────────

export const OKR_EVIDENCE_TARGET_KINDS = {
  ...OKR_EVIDENCE_SOURCE_KINDS,
  OBJECTIVE: 'objective',
  KEY_RESULT: 'key_result',
} as const

export type OkrEvidenceTargetKind =
  (typeof OKR_EVIDENCE_TARGET_KINDS)[keyof typeof OKR_EVIDENCE_TARGET_KINDS]

// ─── Core DTOs ──────────────────────────────────────────────────────────────

/** OKR Cycle */
export interface OkrCycle {
  id: number
  organizationId: number
  title: string
  description: string | null
  startDate: string
  endDate: string
  status: OkrStatus
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** OKR Objective */
export interface OkrObjective {
  id: number
  organizationId: number
  cycleId: number | null
  projectId: number | null
  teamId: number | null
  ownerId: number | null
  scope: OkrScope
  title: string
  description: string | null
  status: OkrStatus
  weight: number
  progress: number
  confidence: OkrConfidenceLevel
  startDate: string | null
  endDate: string | null
  metricVersion: string
  calculatedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** OKR Key Result */
export interface OkrKeyResult {
  id: number
  organizationId: number
  objectiveId: number
  title: string
  description: string | null
  measurementType: OkrMeasurementType
  unitLabel: string | null
  baselineValue: number
  targetValue: number
  currentValue: number
  confidence: OkrConfidenceLevel
  status: OkrStatus
  weight: number
  lastUpdatedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** OKR Alignment */
export interface OkrAlignment {
  id: number
  organizationId: number
  childObjectiveId: number
  parentObjectiveId: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** OKR Evidence Link */
export interface OkrEvidenceLink {
  id: number
  organizationId: number
  targetType: OkrEvidenceTargetKind
  targetId: number
  sourceKind: OkrEvidenceSourceKind
  sourceId: number
  summary: string
  hash: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** OKR Progress History */
export interface OkrProgressHistory {
  id: number
  organizationId: number
  keyResultId: number
  previousValue: number
  newValue: number
  source: string
  confidence: OkrConfidenceLevel
  note: string | null
  evidenceRefs: string | null
  recordedBy: number
  recordedAt: string
  createdAt: string
}

// ─── Request / Response DTOs ────────────────────────────────────────────────

export interface OkrCycleCreateRequest {
  title: string
  description?: string | null
  startDate: string
  endDate: string
  status?: OkrStatus
}

export interface OkrCycleUpdateRequest {
  title?: string
  description?: string | null
  startDate?: string
  endDate?: string
  status?: OkrStatus
}

export interface OkrObjectiveCreateRequest {
  cycleId?: number | null
  projectId?: number | null
  teamId?: number | null
  ownerId?: number | null
  scope: OkrScope
  title: string
  description?: string | null
  status?: OkrStatus
  weight?: number
  startDate?: string | null
  endDate?: string | null
}

export interface OkrObjectiveUpdateRequest {
  cycleId?: number | null
  projectId?: number | null
  teamId?: number | null
  ownerId?: number | null
  scope?: OkrScope
  title?: string
  description?: string | null
  status?: OkrStatus
  weight?: number
  startDate?: string | null
  endDate?: string | null
}

export interface OkrKeyResultCreateRequest {
  objectiveId: number
  title: string
  description?: string | null
  measurementType: OkrMeasurementType
  unitLabel?: string | null
  baselineValue: number
  targetValue: number
  currentValue?: number
  confidence?: OkrConfidenceLevel
  status?: OkrStatus
  weight?: number
}

export interface OkrKeyResultUpdateRequest {
  title?: string
  description?: string | null
  measurementType?: OkrMeasurementType
  unitLabel?: string | null
  baselineValue?: number
  targetValue?: number
  currentValue?: number
  confidence?: OkrConfidenceLevel
  status?: OkrStatus
  weight?: number
}

export interface OkrProgressUpdateRequest {
  currentValue: number
  confidence?: OkrConfidenceLevel
  note?: string | null
  evidenceRefs?: string | null
}

export interface OkrAlignmentCreateRequest {
  childObjectiveId: number
  parentObjectiveId: number
}

export interface OkrEvidenceLinkCreateRequest {
  targetType: OkrEvidenceTargetKind
  targetId: number
  sourceKind: OkrEvidenceSourceKind
  sourceId: number
  summary: string
}

// ─── Query DTOs ──────────────────────────────────────────────────────────────

export interface OkrCycleListQuery {
  status?: OkrStatus | OkrStatus[]
  sort?: OkrSortField
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

export interface OkrObjectiveListQuery {
  cycleId?: number
  scope?: OkrScope | OkrScope[]
  status?: OkrStatus | OkrStatus[]
  ownerId?: number
  projectId?: number
  teamId?: number
  sort?: OkrSortField
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
  include?: OkrIncludeOption[]
}

export interface OkrTreeQuery {
  cycleId?: number
  scope?: OkrScope
  status?: OkrStatus | OkrStatus[]
  depth?: number
  rootObjectiveId?: number
  include?: OkrIncludeOption[]
}

export interface OkrKeyResultListQuery {
  objectiveId?: number
  status?: OkrStatus | OkrStatus[]
  sort?: OkrSortField
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
  include?: OkrIncludeOption[]
}

export interface OkrEvidenceListQuery {
  targetType?: OkrEvidenceTargetKind
  targetId?: number
  sourceKind?: OkrEvidenceSourceKind
  page?: number
  perPage?: number
}

// ─── Response DTOs ───────────────────────────────────────────────────────────

export interface OkrCycleResponse {
  data: OkrCycle
}

export interface OkrCycleListResponse {
  data: OkrCycle[]
  meta: OkrListMeta
}

export interface OkrObjectiveResponse {
  data: OkrObjective
}

export interface OkrObjectiveListResponse {
  data: OkrObjective[]
  meta: OkrListMeta
}

export interface OkrTreeResponse {
  /** 后端 `OkrService.getTree` 返回的是根节点森林，不是单棵树。 */
  data: OkrObjectiveTree[]
  meta: OkrTreeMeta
}

export interface OkrKeyResultResponse {
  data: OkrKeyResult
}

export interface OkrKeyResultListResponse {
  data: OkrKeyResult[]
  meta: OkrListMeta
}

export interface OkrAlignmentListResponse {
  data: OkrAlignment[]
  meta: OkrListMeta
}

export interface OkrEvidenceLinkListResponse {
  data: OkrEvidenceLink[]
  meta: OkrListMeta
}

export interface OkrProgressHistoryListResponse {
  data: OkrProgressHistory[]
  meta: OkrListMeta
}

// ─── Tree / Rollup DTOs ────────────────────────────────────────────────────

export interface OkrObjectiveTree {
  objective: OkrObjective
  children: OkrObjectiveTree[]
  keyResults: OkrKeyResult[]
  alignments: OkrAlignment[]
  evidence: OkrEvidenceLink[]
}

export interface OkrRollupResult {
  progress: number
  confidence: OkrConfidenceLevel
  metricVersion: string
  calculatedAt: string
  sourceCount: number
  restrictedCount: number
  warnings: OkrWarning[]
}

export interface OkrObjectiveDetailResponse {
  data: OkrObjective & {
    rollup: OkrRollupResult
    children?: OkrObjectiveTree[]
    keyResults?: OkrKeyResult[]
    alignments?: OkrAlignment[]
    evidence?: OkrEvidenceLink[]
  }
}

// ─── Warning ────────────────────────────────────────────────────────────────

export interface OkrWarning {
  code: OkrWarningCode
  message: string
  details?: Record<string, unknown>
}

// ─── Meta ───────────────────────────────────────────────────────────────────

export interface OkrListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface OkrTreeMeta {
  totalNodes: number
  maxDepth: number
  truncated: boolean
  warnings: OkrWarning[]
}

// ─── AI Draft DTOs ─────────────────────────────────────────────────────────

export interface OkrAiDraftRequest {
  cycleId?: number | null
  scope?: OkrScope
  context?: string
  includeAlignment?: boolean
  includeRisk?: boolean
}

export interface OkrAiDraftObjective {
  title: string
  description: string
  scope: OkrScope
  confidence: OkrConfidenceLevel
  keyResults: OkrAiDraftKeyResult[]
  alignment?: OkrAiDraftAlignment
}

export interface OkrAiDraftKeyResult {
  title: string
  description: string
  measurementType: OkrMeasurementType
  unitLabel?: string
  baselineValue: number
  targetValue: number
  confidence: OkrConfidenceLevel
}

export interface OkrAiDraftAlignment {
  parentObjectiveTitle: string
  rationale: string
}

export interface OkrAiDraftRisk {
  code: OkrWarningCode
  message: string
  severity: 'low' | 'medium' | 'high'
  suggestion: string
}

export interface OkrAiDraftResponse {
  objectives: OkrAiDraftObjective[]
  risks: OkrAiDraftRisk[]
  assumptions: string[]
  sourceRefs: string[]
  confidence: OkrConfidenceLevel
  warnings: OkrWarning[]
}

export interface OkrAiDraftConfirmationRequest {
  draftId: string
  accepted: OkrAiDraftAcceptedItem[]
}

export interface OkrAiDraftAcceptedItem {
  kind: 'objective' | 'key_result' | 'alignment'
  data: Record<string, unknown>
}

// ─── Type Guards ────────────────────────────────────────────────────────────

export function isOkrMeasurementType(value: unknown): value is OkrMeasurementType {
  return (
    typeof value === 'string' && OKR_MEASUREMENT_TYPE_VALUES.includes(value as OkrMeasurementType)
  )
}

export function isOkrScope(value: unknown): value is OkrScope {
  return typeof value === 'string' && OKR_SCOPE_VALUES.includes(value as OkrScope)
}

export function isOkrStatus(value: unknown): value is OkrStatus {
  return typeof value === 'string' && OKR_STATUS_VALUES.includes(value as OkrStatus)
}

export function isOkrConfidenceLevel(value: unknown): value is OkrConfidenceLevel {
  return (
    typeof value === 'string' && OKR_CONFIDENCE_LEVEL_VALUES.includes(value as OkrConfidenceLevel)
  )
}

export function isOkrWarningCode(value: unknown): value is OkrWarningCode {
  return typeof value === 'string' && OKR_WARNING_CODE_VALUES.includes(value as OkrWarningCode)
}

export function isOkrEvidenceSourceKind(value: unknown): value is OkrEvidenceSourceKind {
  return (
    typeof value === 'string' &&
    OKR_EVIDENCE_SOURCE_KIND_VALUES.includes(value as OkrEvidenceSourceKind)
  )
}

export function isOkrSortField(value: unknown): value is OkrSortField {
  return typeof value === 'string' && OKR_SORT_FIELD_VALUES.includes(value as OkrSortField)
}

export function isOkrIncludeOption(value: unknown): value is OkrIncludeOption {
  return typeof value === 'string' && OKR_INCLUDE_VALUES.includes(value as OkrIncludeOption)
}

export function isOkrEvidenceTargetKind(value: unknown): value is OkrEvidenceTargetKind {
  return (
    typeof value === 'string' &&
    (OKR_EVIDENCE_SOURCE_KIND_VALUES.includes(value as OkrEvidenceSourceKind) ||
      value === 'objective' ||
      value === 'key_result')
  )
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

export function validateMeasurementBounds(
  measurementType: OkrMeasurementType,
  value: number,
): { valid: boolean; message?: string } {
  const bounds = OKR_MEASUREMENT_BOUNDS[measurementType]
  if (value < bounds.min || value > bounds.max) {
    return {
      valid: false,
      message: `值超出 ${measurementType} 允许范围 [${bounds.min}, ${bounds.max}]`,
    }
  }
  return { valid: true }
}

export function validateWeight(weight: number): { valid: boolean; message?: string } {
  if (weight < 0 || weight > 100 || !Number.isFinite(weight)) {
    return { valid: false, message: '权重必须在 0-100 之间' }
  }
  return { valid: true }
}

export function validateScope(scope: OkrScope): { valid: boolean; message?: string } {
  if (OKR_DISABLED_SCOPES.includes(scope)) {
    return { valid: false, message: `scope '${scope}' 当前默认禁用写入` }
  }
  return { valid: true }
}

// ─── Warning Helpers ────────────────────────────────────────────────────────

export function makeEmptyOkrWarning(): OkrWarning {
  return { code: 'EMPTY_OKR_RESULT', message: 'OKR 查询无结果' }
}

export function makeEmptyKeyResultsWarning(): OkrWarning {
  return { code: 'EMPTY_KEY_RESULTS', message: '目标没有活跃的关键结果' }
}

export function makeRestrictedChildWarning(count: number): OkrWarning {
  return {
    code: 'RESTRICTED_CHILD',
    message: `${count} 个子节点因权限受限被隐藏`,
    details: { restrictedCount: count },
  }
}

export function makeStaleEvidenceWarning(sourceKind: OkrEvidenceSourceKind): OkrWarning {
  return { code: 'STALE_EVIDENCE', message: `${sourceKind} 证据可能已过期` }
}

export function makeEvidenceUnavailableWarning(
  kind: OkrEvidenceTargetKind,
  id: number,
): OkrWarning {
  return { code: 'EVIDENCE_UNAVAILABLE', message: `${kind} ${id} 的证据不可用` }
}

export function makeCycleDetectedWarning(): OkrWarning {
  return { code: 'CYCLE_DETECTED', message: '检测到对齐循环，已拒绝写入' }
}

export function makeMaxDepthExceededWarning(maxDepth: number): OkrWarning {
  return { code: 'MAX_DEPTH_EXCEEDED', message: `对齐深度超过限制 ${maxDepth}` }
}

export function makeDuplicateAlignmentWarning(): OkrWarning {
  return { code: 'DUPLICATE_ALIGNMENT', message: '已存在活跃的对齐关系' }
}

export function makeDisabledScopeWarning(scope: OkrScope): OkrWarning {
  return { code: 'DISABLED_SCOPE', message: `scope '${scope}' 当前禁用` }
}

export function makeCrossOrganizationWarning(): OkrWarning {
  return { code: 'CROSS_ORGANIZATION', message: '跨组织操作被拒绝' }
}

export function makeInvalidWeightWarning(): OkrWarning {
  return { code: 'INVALID_WEIGHT', message: '权重值无效' }
}

export function makeInvalidMeasurementWarning(): OkrWarning {
  return { code: 'INVALID_MEASUREMENT', message: '度量值超出允许范围' }
}

export function makeAiDraftUnavailableWarning(): OkrWarning {
  return { code: 'AI_DRAFT_UNAVAILABLE', message: 'AI 草案生成暂不可用' }
}

export function makeAiContextRestrictedWarning(): OkrWarning {
  return { code: 'AI_CONTEXT_RESTRICTED', message: '部分上下文因权限受限未纳入 AI 分析' }
}

export function makeLargeTreeTruncatedWarning(totalNodes: number): OkrWarning {
  return { code: 'LARGE_TREE_TRUNCATED', message: `大树已被截断，总节点数 ${totalNodes}` }
}

export function makeCacheDegradedWarning(): OkrWarning {
  return { code: 'CACHE_DEGRADED', message: '缓存服务降级，结果可能不是最新' }
}

export function mergeOkrWarnings(warningsArrays: OkrWarning[][]): OkrWarning[] {
  const seen = new Set<string>()
  const merged: OkrWarning[] = []
  for (const arr of warningsArrays) {
    for (const w of arr) {
      if (!seen.has(w.code)) {
        seen.add(w.code)
        merged.push(w)
      }
    }
  }
  return merged
}

// ─── Progress Rollup ────────────────────────────────────────────────────────

export function computeOkrRollup(
  keyResults: OkrKeyResult[],
  childRollups: OkrRollupResult[],
): OkrRollupResult {
  const activeKrs = keyResults.filter((kr) => kr.deletedAt === null && kr.status !== 'archived')
  const warnings: OkrWarning[] = []

  if (activeKrs.length === 0 && childRollups.length === 0) {
    warnings.push(makeEmptyKeyResultsWarning())
    return {
      progress: 0,
      confidence: 'low',
      metricVersion: OKR_METRIC_VERSION,
      calculatedAt: new Date().toISOString(),
      sourceCount: 0,
      restrictedCount: 0,
      warnings,
    }
  }

  let totalWeight = 0
  let weightedProgress = 0
  let confidenceScores: number[] = []
  let sourceCount = 0
  let restrictedCount = 0

  // KR 按权重汇总
  for (const kr of activeKrs) {
    const krProgress = computeKrProgress(kr)
    totalWeight += kr.weight
    weightedProgress += krProgress * kr.weight
    confidenceScores.push(confidenceToScore(kr.confidence))
    sourceCount++
  }

  // 子目标汇总
  for (const child of childRollups) {
    totalWeight += 1 // 每个子目标默认权重 1
    weightedProgress += child.progress
    confidenceScores.push(confidenceToScore(child.confidence))
    sourceCount += child.sourceCount
    restrictedCount += child.restrictedCount
  }

  const progress = totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0
  const avgConfidenceScore =
    confidenceScores.length > 0
      ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
      : 0
  const confidence: OkrConfidenceLevel =
    avgConfidenceScore >= 0.7 ? 'high' : avgConfidenceScore >= 0.4 ? 'medium' : 'low'

  return {
    progress,
    confidence,
    metricVersion: OKR_METRIC_VERSION,
    calculatedAt: new Date().toISOString(),
    sourceCount,
    restrictedCount,
    warnings,
  }
}

function computeKrProgress(kr: OkrKeyResult): number {
  if (kr.targetValue === kr.baselineValue) return 0
  const raw = ((kr.currentValue - kr.baselineValue) / (kr.targetValue - kr.baselineValue)) * 100
  return Math.max(0, Math.min(100, Math.round(raw)))
}

function confidenceToScore(level: OkrConfidenceLevel): number {
  switch (level) {
    case 'high':
      return 1.0
    case 'medium':
      return 0.5
    case 'low':
      return 0.1
  }
}

// ─── Alignment Validation ───────────────────────────────────────────────────

export function validateAlignment(
  childObjective: OkrObjective,
  parentObjective: OkrObjective,
  existingAlignments: OkrAlignment[],
  ancestors: number[],
): { valid: boolean; warning?: OkrWarning } {
  // 不能自对齐
  if (childObjective.id === parentObjective.id) {
    return { valid: false, warning: makeCycleDetectedWarning() }
  }

  // 不能跨组织
  if (childObjective.organizationId !== parentObjective.organizationId) {
    return { valid: false, warning: makeCrossOrganizationWarning() }
  }

  // 不能循环
  if (ancestors.includes(childObjective.id)) {
    return { valid: false, warning: makeCycleDetectedWarning() }
  }

  // 不能超过最大深度
  if (ancestors.length >= OKR_ALIGNMENT_CONSTRAINTS.MAX_DEPTH) {
    return {
      valid: false,
      warning: makeMaxDepthExceededWarning(OKR_ALIGNMENT_CONSTRAINTS.MAX_DEPTH),
    }
  }

  // 不能有重复活跃父级
  const activeParent = existingAlignments.find(
    (a) => a.childObjectiveId === childObjective.id && a.deletedAt === null,
  )
  if (activeParent) {
    return { valid: false, warning: makeDuplicateAlignmentWarning() }
  }

  return { valid: true }
}

// ─── Cycle Validation ────────────────────────────────────────────────────────

export function validateCycleDateWindow(
  startDate: string,
  endDate: string,
): { valid: boolean; warning?: OkrWarning } {
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, warning: makeInvalidMeasurementWarning() }
  }
  if (start >= end) {
    return { valid: false, warning: makeInvalidMeasurementWarning() }
  }
  return { valid: true }
}

// ─── Stable Hash ────────────────────────────────────────────────────────────

export function okrStableHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

// ─── Freshness ──────────────────────────────────────────────────────────────

export interface OkrFreshness {
  source: string
  lastUpdatedAt: string
  stale: boolean
}

export function makeOkrFreshness(lastUpdatedAt: string, maxAgeMs?: number): OkrFreshness {
  const now = Date.now()
  const updated = new Date(lastUpdatedAt).getTime()
  const maxAge = maxAgeMs ?? 24 * 60 * 60 * 1000 // default 24h
  return {
    source: 'okr',
    lastUpdatedAt,
    stale: now - updated > maxAge,
  }
}

export function mergeOkrFreshness(freshnessList: OkrFreshness[]): OkrFreshness {
  if (freshnessList.length === 0) {
    return { source: 'okr', lastUpdatedAt: new Date(0).toISOString(), stale: true }
  }
  return freshnessList.reduce((latest, f) =>
    new Date(f.lastUpdatedAt) > new Date(latest.lastUpdatedAt) ? f : latest,
  )
}

// ─── Fixture Builders ─────────────────────────────────────────────────────────

export function makeOkrCycle(overrides: Partial<OkrCycle> = {}): OkrCycle {
  return {
    id: 1,
    organizationId: 1,
    title: '2026 Q3',
    description: 'Q3 OKR 周期',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrObjective(overrides: Partial<OkrObjective> = {}): OkrObjective {
  return {
    id: 1,
    organizationId: 1,
    cycleId: null,
    projectId: null,
    teamId: null,
    ownerId: null,
    scope: 'organization',
    title: '提升产品体验',
    description: '通过改进核心流程提升用户满意度',
    status: 'active',
    weight: 1,
    progress: 0,
    confidence: 'medium',
    startDate: null,
    endDate: null,
    metricVersion: OKR_METRIC_VERSION,
    calculatedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrKeyResult(overrides: Partial<OkrKeyResult> = {}): OkrKeyResult {
  return {
    id: 1,
    organizationId: 1,
    objectiveId: 1,
    title: '核心功能满意度提升至 90%',
    description: null,
    measurementType: 'percent',
    unitLabel: '%',
    baselineValue: 0,
    targetValue: 100,
    currentValue: 50,
    confidence: 'medium',
    status: 'active',
    weight: 100,
    lastUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrAlignment(overrides: Partial<OkrAlignment> = {}): OkrAlignment {
  return {
    id: 1,
    organizationId: 1,
    childObjectiveId: 1,
    parentObjectiveId: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrEvidenceLink(overrides: Partial<OkrEvidenceLink> = {}): OkrEvidenceLink {
  return {
    id: 1,
    organizationId: 1,
    targetType: 'objective',
    targetId: 1,
    sourceKind: 'project',
    sourceId: 1,
    summary: '项目里程碑完成证据',
    hash: okrStableHash('objective:1:project:1'),
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrProgressHistory(
  overrides: Partial<OkrProgressHistory> = {},
): OkrProgressHistory {
  return {
    id: 1,
    organizationId: 1,
    keyResultId: 1,
    previousValue: 30,
    newValue: 50,
    source: 'manual',
    confidence: 'medium',
    note: null,
    evidenceRefs: null,
    recordedBy: 1,
    recordedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeOkrAiDraftResponse(
  overrides: Partial<OkrAiDraftResponse> = {},
): OkrAiDraftResponse {
  return {
    objectives: [
      {
        title: '示例目标',
        description: '这是 AI 生成的 OKR 草案示例',
        scope: 'organization',
        confidence: 'medium',
        keyResults: [
          {
            title: '示例关键结果',
            description: '可度量的关键结果',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 0,
            targetValue: 100,
            confidence: 'medium',
          },
        ],
      },
    ],
    risks: [],
    assumptions: ['基于当前组织数据生成', '需人工审查确认'],
    sourceRefs: ['组织上下文', '项目列表'],
    confidence: 'medium',
    warnings: [],
    ...overrides,
  }
}

/** 空组织 fixture：无目标、无 KR、无对齐 */
export function makeEmptyOrganizationOkrFixture(organizationId = 99) {
  const cycle = makeOkrCycle({ id: 1, organizationId, status: 'active' })
  return { cycles: [cycle], objectives: [], keyResults: [], alignments: [], evidenceLinks: [] }
}

/** 正常组织 fixture：含周期、目标、KR、对齐、证据 */
export function makeNormalOkrFixture(organizationId = 1) {
  const cycle = makeOkrCycle({ id: 1, organizationId })
  const obj1 = makeOkrObjective({
    id: 1,
    organizationId,
    cycleId: 1,
    title: '组织级目标',
    scope: 'organization',
  })
  const obj2 = makeOkrObjective({
    id: 2,
    organizationId,
    cycleId: 1,
    title: '团队目标',
    scope: 'team',
    progress: 50,
  })
  const obj3 = makeOkrObjective({
    id: 3,
    organizationId,
    cycleId: 1,
    title: '项目目标',
    scope: 'project',
    projectId: 1,
  })
  const kr1 = makeOkrKeyResult({
    id: 1,
    organizationId,
    objectiveId: 1,
    title: 'KR1',
    currentValue: 80,
    targetValue: 100,
    weight: 60,
  })
  const kr2 = makeOkrKeyResult({
    id: 2,
    organizationId,
    objectiveId: 1,
    title: 'KR2',
    currentValue: 40,
    targetValue: 100,
    weight: 40,
  })
  const kr3 = makeOkrKeyResult({
    id: 3,
    organizationId,
    objectiveId: 2,
    title: 'KR3',
    currentValue: 50,
    targetValue: 100,
    weight: 100,
  })
  const alignment = makeOkrAlignment({
    id: 1,
    organizationId,
    childObjectiveId: 2,
    parentObjectiveId: 1,
  })
  const alignment2 = makeOkrAlignment({
    id: 2,
    organizationId,
    childObjectiveId: 3,
    parentObjectiveId: 2,
  })
  const evidence = makeOkrEvidenceLink({
    id: 1,
    organizationId,
    targetType: 'objective',
    targetId: 1,
    sourceKind: 'project',
    sourceId: 1,
  })
  return {
    cycles: [cycle],
    objectives: [obj1, obj2, obj3],
    keyResults: [kr1, kr2, kr3],
    alignments: [alignment, alignment2],
    evidenceLinks: [evidence],
  }
}

/** 受限证据 fixture：部分证据因权限不可见 */
export function makeRestrictedEvidenceOkrFixture(organizationId = 1) {
  const base = makeNormalOkrFixture(organizationId)
  const restrictedEvidence = makeOkrEvidenceLink({
    id: 2,
    organizationId,
    targetType: 'key_result',
    targetId: 1,
    sourceKind: 'task',
    sourceId: 999,
    summary: '[受限] 此证据需要额外权限',
    hash: '[redacted]',
  })
  return { ...base, evidenceLinks: [...base.evidenceLinks, restrictedEvidence] }
}

/** 大树 fixture：生成大量节点用于性能测试 */
export function makeLargeTreeOkrFixture(
  organizationId = 1,
  nodeCount = 1000,
): {
  cycles: OkrCycle[]
  objectives: OkrObjective[]
  keyResults: OkrKeyResult[]
  alignments: OkrAlignment[]
  evidenceLinks: OkrEvidenceLink[]
} {
  const cycle = makeOkrCycle({ id: 1, organizationId })
  const objectives: OkrObjective[] = []
  const keyResults: OkrKeyResult[] = []
  const alignments: OkrAlignment[] = []

  for (let i = 1; i <= nodeCount; i++) {
    const parentId = i > 1 ? i - 1 : null
    objectives.push(
      makeOkrObjective({
        id: i,
        organizationId,
        cycleId: 1,
        title: `目标 ${i}`,
        scope: i % 3 === 0 ? 'project' : i % 3 === 1 ? 'team' : 'organization',
        progress: Math.round((i / nodeCount) * 100),
      }),
    )
    if (parentId) {
      alignments.push(
        makeOkrAlignment({
          id: i - 1,
          organizationId,
          childObjectiveId: i,
          parentObjectiveId: parentId,
        }),
      )
    }
    // 每个目标附带 1 个 KR
    keyResults.push(
      makeOkrKeyResult({
        id: i,
        organizationId,
        objectiveId: i,
        title: `KR ${i}`,
        currentValue: Math.round(Math.random() * 100),
        targetValue: 100,
        weight: 100,
      }),
    )
  }

  return { cycles: [cycle], objectives, keyResults, alignments, evidenceLinks: [] }
}

/** AI draft preview fixture */
export function makeAiDraftPreviewOkrFixture(organizationId = 1) {
  const cycle = makeOkrCycle({ id: 1, organizationId })
  const draft = makeOkrAiDraftResponse({
    objectives: [
      {
        title: 'AI 建议：提升用户留存',
        description: '基于当前组织数据，建议聚焦用户留存率提升',
        scope: 'organization',
        confidence: 'high',
        keyResults: [
          {
            title: '7日留存率提升至 60%',
            description: '通过优化 onboarding 流程',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 45,
            targetValue: 60,
            confidence: 'medium',
          },
          {
            title: '30日留存率提升至 40%',
            description: '通过个性化推荐',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 25,
            targetValue: 40,
            confidence: 'low',
          },
        ],
        alignment: {
          parentObjectiveTitle: '组织战略：用户体验优先',
          rationale: '留存率是用户满意度的直接指标',
        },
      },
    ],
    risks: [
      {
        code: 'AI_CONTEXT_RESTRICTED' as any,
        message: '部分项目数据不可见，建议可能不完整',
        severity: 'medium',
        suggestion: '请确认是否有额外项目需要纳入考量',
      },
    ],
    assumptions: ['基于当前组织项目数据', '假设团队资源配置不变'],
    sourceRefs: ['项目列表', '组织资源池'],
    confidence: 'medium',
  })
  return { cycles: [cycle], draft, organizationId }
}

// ─── Cascade Plan Types ─────────────────────────────────────────────────────

export const OKR_CASCADE_PLAN_STATUSES = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
} as const

export type OkrCascadePlanStatus =
  (typeof OKR_CASCADE_PLAN_STATUSES)[keyof typeof OKR_CASCADE_PLAN_STATUSES]

export const OKR_CASCADE_PLAN_STATUS_VALUES = Object.values(
  OKR_CASCADE_PLAN_STATUSES,
) as readonly OkrCascadePlanStatus[]

export const OKR_CASCADE_ITEM_STATUSES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
} as const

export type OkrCascadeItemStatus =
  (typeof OKR_CASCADE_ITEM_STATUSES)[keyof typeof OKR_CASCADE_ITEM_STATUSES]

export const OKR_CASCADE_ITEM_STATUS_VALUES = Object.values(
  OKR_CASCADE_ITEM_STATUSES,
) as readonly OkrCascadeItemStatus[]

export const OKR_CASCADE_COVERAGE_LEVELS = {
  FULL: 'full',
  PARTIAL: 'partial',
  GAP: 'gap',
  UNKNOWN: 'unknown',
} as const

export type OkrCascadeCoverageLevel =
  (typeof OKR_CASCADE_COVERAGE_LEVELS)[keyof typeof OKR_CASCADE_COVERAGE_LEVELS]

// ─── Cross-Objective Relation Types ────────────────────────────────────────

export const OKR_RELATION_TYPES = {
  DEPENDS_ON: 'depends_on',
  CONTRIBUTES_TO: 'contributes_to',
  SUPPORTS: 'supports',
  CONFLICTS_WITH: 'conflicts_with',
  DUPLICATES: 'duplicates',
} as const

export type OkrRelationType = (typeof OKR_RELATION_TYPES)[keyof typeof OKR_RELATION_TYPES]

export const OKR_RELATION_TYPE_VALUES = Object.values(
  OKR_RELATION_TYPES,
) as readonly OkrRelationType[]

export const OKR_RELATION_STATUSES = {
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  ARCHIVED: 'archived',
} as const

export type OkrRelationStatus = (typeof OKR_RELATION_STATUSES)[keyof typeof OKR_RELATION_STATUSES]

export const OKR_RELATION_STATUS_VALUES = Object.values(
  OKR_RELATION_STATUSES,
) as readonly OkrRelationStatus[]

export const OKR_RELATION_SYMMETRIC_PAIRS: Record<OkrRelationType, OkrRelationType | null> = {
  depends_on: null, // 非对称
  contributes_to: null, // 非对称
  supports: 'supports', // 对称（双向）
  conflicts_with: 'conflicts_with', // 对称
  duplicates: 'duplicates', // 对称
}

// ─── Health Levels ──────────────────────────────────────────────────────────

export const OKR_HEALTH_LEVELS = {
  HEALTHY: 'healthy',
  NEEDS_ATTENTION: 'needs_attention',
  AT_RISK: 'at_risk',
  UNAVAILABLE: 'unavailable',
} as const

export type OkrHealthLevel = (typeof OKR_HEALTH_LEVELS)[keyof typeof OKR_HEALTH_LEVELS]

export const OKR_HEALTH_LEVEL_VALUES = Object.values(OKR_HEALTH_LEVELS) as readonly OkrHealthLevel[]

export const OKR_HEALTH_SCORE_BANDS: Record<OkrHealthLevel, { min: number; max: number }> = {
  healthy: { min: 70, max: 100 },
  needs_attention: { min: 40, max: 69 },
  at_risk: { min: 0, max: 39 },
  unavailable: { min: -1, max: -1 },
}

// ─── Cascade Plan DTOs ──────────────────────────────────────────────────────

/** 级联计划 */
export interface OkrCascadePlan {
  id: number
  organizationId: number
  sourceObjectiveId: number
  cycleId: number
  title: string
  description: string | null
  status: OkrCascadePlanStatus
  coverage: OkrCascadeCoverageLevel
  warnings: OkrWarning[]
  assumptions: string[]
  sourceRefs: string[]
  metricVersion: string
  revisionHash: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** 级联计划项 */
export interface OkrCascadePlanItem {
  id: number
  planId: number
  organizationId: number
  candidateObjective: OkrAiDraftObjective
  status: OkrCascadeItemStatus
  coverageGap: boolean
  conflictWarning: string | null
  rejectionReason: string | null
  confirmedObjectiveId: number | null
  createdAt: string
  updatedAt: string
}

/** 横向目标关系 */
export interface OkrObjectiveRelation {
  id: number
  organizationId: number
  sourceObjectiveId: number
  targetObjectiveId: number
  relationType: OkrRelationType
  status: OkrRelationStatus
  impactWeight: number
  reasonCode: string | null
  evidenceRefHash: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** 对齐健康度 */
export interface OkrAlignmentHealth {
  objectiveId: number
  score: number
  level: OkrHealthLevel
  warnings: OkrWarning[]
  impactSummary: string | null
  metricVersion: string
  calculatedAt: string
  freshness: OkrFreshness
  redactedCount: number
}

/** 对齐矩阵行 */
export interface OkrAlignmentMatrixRow {
  objectiveId: number
  objectiveTitle: string
  scope: OkrScope
  ownerId: number | null
  status: OkrStatus
  health?: OkrAlignmentHealth
  relations: OkrObjectiveRelation[]
  parentAlignmentId: number | null
  childCount: number
  restricted: boolean
}

/** 确认差异 */
export interface OkrCascadeConfirmationDiff {
  itemId: number
  kind: 'objective' | 'key_result' | 'alignment'
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  warnings: OkrWarning[]
}

/** AI 级联/对齐建议 payload */
export interface OkrAiCascadeSuggestionRequest {
  cycleId: number
  objectiveId?: number
  scope?: OkrScope
  includeRelations?: boolean
  includeConflictAnalysis?: boolean
}

export interface OkrAiCascadeSuggestionResponse {
  cascadeCandidates: OkrAiDraftObjective[]
  relationSuggestions: OkrAiRelationSuggestion[]
  conflictExplanations: OkrAiConflictExplanation[]
  missingAlignmentPrompts: string[]
  confidence: OkrConfidenceLevel
  assumptions: string[]
  sourceRefs: string[]
  warnings: OkrWarning[]
}

export interface OkrAiRelationSuggestion {
  sourceObjectiveTitle: string
  targetObjectiveTitle: string
  relationType: OkrRelationType
  rationale: string
  confidence: OkrConfidenceLevel
  impactWeight: number
}

export interface OkrAiConflictExplanation {
  objectiveTitles: string[]
  conflictType: string
  explanation: string
  severity: 'low' | 'medium' | 'high'
  suggestion: string
}

// ─── Request / Response DTOs for Cascade ────────────────────────────────────

export interface OkrCascadePlanCreateRequest {
  sourceObjectiveId: number
  title?: string
  includePersonalScope?: boolean
}

export interface OkrCascadePlanItemConfirmRequest {
  acceptedItemIds: number[]
  rejectedItemIds?: number[]
  rejectionReasons?: Record<number, string>
}

export interface OkrCascadePlanItemRejectRequest {
  rejectedItemIds: number[]
  reason: string
}

export interface OkrRelationCreateRequest {
  sourceObjectiveId: number
  targetObjectiveId: number
  relationType: OkrRelationType
  impactWeight?: number
  reasonCode?: string | null
}

export interface OkrRelationUpdateRequest {
  relationType?: OkrRelationType
  impactWeight?: number
  reasonCode?: string | null
  status?: OkrRelationStatus
}

export interface OkrHealthQuery {
  cycleId?: number
  scope?: OkrScope | OkrScope[]
  ownerId?: number
  status?: OkrStatus | OkrStatus[]
  relationType?: OkrRelationType
  includeRestricted?: boolean
}

export interface OkrAlignmentMatrixQuery {
  cycleId?: number
  scope?: OkrScope | OkrScope[]
  ownerId?: number
  status?: OkrStatus | OkrStatus[]
  relationType?: OkrRelationType
  healthLevel?: OkrHealthLevel
  depth?: number
  page?: number
  perPage?: number
  sort?: 'title' | 'health' | 'scope' | 'status'
  order?: 'asc' | 'desc'
}

// ─── Alignment Matrix / Cascade / Health / AI Response DTOs ─────────────────

export interface OkrCascadePlanResponse {
  data: OkrCascadePlan
}

export interface OkrCascadePlanListResponse {
  data: OkrCascadePlan[]
  meta: OkrListMeta
}

export interface OkrCascadePlanDetailResponse {
  data: OkrCascadePlan & { items: OkrCascadePlanItem[] }
}

export interface OkrRelationResponse {
  data: OkrObjectiveRelation
}

export interface OkrRelationListResponse {
  data: OkrObjectiveRelation[]
  meta: OkrListMeta
}

export interface OkrHealthResponse {
  data: OkrAlignmentHealth
}

export interface OkrHealthListResponse {
  data: OkrAlignmentHealth[]
  meta: OkrListMeta
}

export interface OkrAlignmentMatrixResponse {
  data: OkrAlignmentMatrixRow[]
  meta: OkrListMeta & {
    cycleTitle?: string
    totalRelations: number
    redactedCount: number
    warnings: OkrWarning[]
  }
}

export interface OkrCascadeConfirmationDiffResponse {
  data: OkrCascadeConfirmationDiff[]
  meta: {
    totalItems: number
    acceptedCount: number
    rejectedCount: number
    warnings: OkrWarning[]
  }
}

export interface OkrAiCascadeSuggestionResponseWrapper {
  data: OkrAiCascadeSuggestionResponse
}

// ─── Type Guards ────────────────────────────────────────────────────────────

export function isOkrCascadePlanStatus(value: unknown): value is OkrCascadePlanStatus {
  return (
    typeof value === 'string' &&
    OKR_CASCADE_PLAN_STATUS_VALUES.includes(value as OkrCascadePlanStatus)
  )
}

export function isOkrRelationType(value: unknown): value is OkrRelationType {
  return typeof value === 'string' && OKR_RELATION_TYPE_VALUES.includes(value as OkrRelationType)
}

export function isOkrRelationStatus(value: unknown): value is OkrRelationStatus {
  return (
    typeof value === 'string' && OKR_RELATION_STATUS_VALUES.includes(value as OkrRelationStatus)
  )
}

export function isOkrHealthLevel(value: unknown): value is OkrHealthLevel {
  return typeof value === 'string' && OKR_HEALTH_LEVEL_VALUES.includes(value as OkrHealthLevel)
}

// ─── Relation Validation Helpers ────────────────────────────────────────────

export function validateRelation(
  sourceObjective: OkrObjective,
  targetObjective: OkrObjective,
  relationType: OkrRelationType,
  existingRelations: OkrObjectiveRelation[],
): { valid: boolean; warning?: OkrWarning } {
  // 不能自关联
  if (sourceObjective.id === targetObjective.id) {
    return { valid: false, warning: { code: 'CYCLE_DETECTED', message: '目标不能与自身创建关系' } }
  }

  // 不能跨组织
  if (sourceObjective.organizationId !== targetObjective.organizationId) {
    return { valid: false, warning: makeCrossOrganizationWarning() }
  }

  // 不能跨周期（如果两者都绑定了不同 cycle）
  if (
    sourceObjective.cycleId &&
    targetObjective.cycleId &&
    sourceObjective.cycleId !== targetObjective.cycleId
  ) {
    return {
      valid: false,
      warning: { code: 'INVALID_MEASUREMENT', message: '目标属于不同 OKR 周期' },
    }
  }

  // 不能重复活跃关系
  const duplicate = existingRelations.find(
    (r) =>
      r.sourceObjectiveId === sourceObjective.id &&
      r.targetObjectiveId === targetObjective.id &&
      r.relationType === relationType &&
      r.deletedAt === null,
  )
  if (duplicate) {
    return {
      valid: false,
      warning: { code: 'DUPLICATE_ALIGNMENT', message: '已存在相同类型的活跃关系' },
    }
  }

  return { valid: true }
}

export function validateRelationType(value: unknown): { valid: boolean; message?: string } {
  if (!isOkrRelationType(value)) {
    return { valid: false, message: `不支持的关系类型: ${String(value)}` }
  }
  return { valid: true }
}

export function makeDuplicateRelationKey(
  sourceObjectiveId: number,
  targetObjectiveId: number,
  relationType: OkrRelationType,
): string {
  return `rel:${sourceObjectiveId}:${targetObjectiveId}:${relationType}`
}

// ─── Cascade Diff Normalization ─────────────────────────────────────────────

export function normalizeCascadeConfirmationDiff(
  items: OkrCascadeConfirmationDiff[],
): OkrCascadeConfirmationDiff[] {
  return items
    .filter((d) => d.after && Object.keys(d.after).length > 0)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.itemId - b.itemId
    })
}

// ─── Alignment Health Calculation ───────────────────────────────────────────

export interface OkrAlignmentHealthInput {
  objective: OkrObjective
  parentAlignment: OkrAlignment | null
  childAlignments: OkrAlignment[]
  crossRelations: OkrObjectiveRelation[]
  keyResults: OkrKeyResult[]
  evidenceFreshness: OkrFreshness | null
  restrictedVisibilityCount: number
}

export function computeOkrAlignmentHealth(input: OkrAlignmentHealthInput): OkrAlignmentHealth {
  const warnings: OkrWarning[] = []
  let score = 100

  // 1. 没有活跃 KR → 降分
  const activeKrs = input.keyResults.filter(
    (kr) => kr.deletedAt === null && kr.status !== 'archived',
  )
  if (activeKrs.length === 0) {
    score -= 30
    warnings.push(makeEmptyKeyResultsWarning())
  }

  // 2. KR 权重不完整 → 降分
  const totalKrWeight = activeKrs.reduce((sum, kr) => sum + kr.weight, 0)
  if (activeKrs.length > 0 && totalKrWeight < 100) {
    score -= 10
    warnings.push({
      code: 'INVALID_WEIGHT',
      message: `KR 权重总和不等于 100 (当前 ${totalKrWeight})`,
    })
  }

  // 3. 没有父级对齐或无 cover → 降分
  if (input.parentAlignment === null && input.objective.scope !== 'organization') {
    score -= 15
    warnings.push({ code: 'EMPTY_OKR_RESULT', message: '缺少父级对齐' })
  }

  // 4. 活跃冲突关系 → 降分
  const activeConflicts = input.crossRelations.filter(
    (r) => r.relationType === 'conflicts_with' && r.status === 'active' && r.deletedAt === null,
  )
  if (activeConflicts.length > 0) {
    score -= 20
    warnings.push({
      code: 'CYCLE_DETECTED',
      message: `存在 ${activeConflicts.length} 个活跃冲突关系`,
    })
  }

  // 5. 证据陈旧 → 降分
  if (input.evidenceFreshness?.stale) {
    score -= 10
    warnings.push(makeStaleEvidenceWarning(input.evidenceFreshness.source as OkrEvidenceSourceKind))
  }

  // 6. 受限可见性 → 降分
  if (input.restrictedVisibilityCount > 0) {
    score -= 5
    warnings.push({
      code: 'RESTRICTED_CHILD',
      message: `${input.restrictedVisibilityCount} 个输入因权限受限未纳入计算`,
      details: { restrictedCount: input.restrictedVisibilityCount },
    })
  }

  // 7. 目标已归档/暂停 → 降分
  if (input.objective.status === 'paused') {
    score -= 15
    warnings.push({ code: 'INVALID_MEASUREMENT', message: '目标当前处于暂停状态' })
  }
  if (input.objective.status === 'archived' || input.objective.status === 'completed') {
    score = input.objective.status === 'completed' ? Math.max(score, 50) : Math.max(score, 20)
    warnings.push({ code: 'STALE_EVIDENCE', message: '目标已关闭/归档' })
  }

  // 8. 计算 level
  const clampedScore = Math.max(0, Math.min(100, score))
  let level: OkrHealthLevel
  if (clampedScore >= OKR_HEALTH_SCORE_BANDS.healthy.min) {
    level = 'healthy'
  } else if (clampedScore >= OKR_HEALTH_SCORE_BANDS.needs_attention.min) {
    level = 'needs_attention'
  } else {
    level = 'at_risk'
  }

  const impactItems: string[] = []
  if (input.parentAlignment) impactItems.push('有父级对齐')
  if (input.childAlignments.length > 0) impactItems.push(`${input.childAlignments.length} 个子目标`)
  if (input.crossRelations.filter((r) => r.relationType === 'supports').length > 0)
    impactItems.push('有支持关系')
  if (activeConflicts.length > 0) impactItems.push(`${activeConflicts.length} 个冲突`)

  return {
    objectiveId: input.objective.id,
    score: clampedScore,
    level,
    warnings,
    impactSummary: impactItems.length > 0 ? impactItems.join('；') : null,
    metricVersion: OKR_METRIC_VERSION,
    calculatedAt: new Date().toISOString(),
    freshness: input.evidenceFreshness ?? {
      source: 'okr',
      lastUpdatedAt: input.objective.updatedAt,
      stale: false,
    },
    redactedCount: input.restrictedVisibilityCount,
  }
}

// ─── Cascade / Alignment Warning Code Extensions ────────────────────────────

export const OKR_HEALTH_WARNING_CODES = {
  ...OKR_WARNING_CODES,
  NO_PARENT_ALIGNMENT: 'NO_PARENT_ALIGNMENT',
  NO_CHILD_COVERAGE: 'NO_CHILD_COVERAGE',
  CONFLICT_ACTIVE: 'CONFLICT_ACTIVE',
  HEALTH_UNAVAILABLE: 'HEALTH_UNAVAILABLE',
  RESTRICTED_TARGET: 'RESTRICTED_TARGET',
  INCOMPATIBLE_CYCLE: 'INCOMPATIBLE_CYCLE',
  UNSUPPORTED_RELATION: 'UNSUPPORTED_RELATION',
  CASCADE_DIFF_STALE: 'CASCADE_DIFF_STALE',
} as const

export type OkrHealthWarningCode =
  (typeof OKR_HEALTH_WARNING_CODES)[keyof typeof OKR_HEALTH_WARNING_CODES]

export const OKR_HEALTH_WARNING_CODE_VALUES = Object.values(
  OKR_HEALTH_WARNING_CODES,
) as readonly OkrHealthWarningCode[]

export function makeNoParentAlignmentWarning(): OkrWarning {
  return { code: 'NO_PARENT_ALIGNMENT' as OkrWarningCode, message: '目标缺少父级对齐' }
}

export function makeNoChildCoverageWarning(): OkrWarning {
  return { code: 'NO_CHILD_COVERAGE' as OkrWarningCode, message: '组织级目标缺少下级拆解' }
}

export function makeConflictActiveWarning(count: number): OkrWarning {
  return { code: 'CONFLICT_ACTIVE' as OkrWarningCode, message: `存在 ${count} 个活跃冲突关系` }
}

export function makeHealthUnavailableWarning(): OkrWarning {
  return { code: 'HEALTH_UNAVAILABLE' as OkrWarningCode, message: '对齐健康度不可用' }
}

export function makeRestrictedTargetWarning(): OkrWarning {
  return { code: 'RESTRICTED_TARGET' as OkrWarningCode, message: '目标关系因权限受限不可见' }
}

export function makeIncompatibleCycleWarning(): OkrWarning {
  return { code: 'INCOMPATIBLE_CYCLE' as OkrWarningCode, message: '目标属于不兼容的 OKR 周期' }
}

export function makeUnsupportedRelationWarning(relationType: string): OkrWarning {
  return {
    code: 'UNSUPPORTED_RELATION' as OkrWarningCode,
    message: `不支持的关系类型: ${relationType}`,
  }
}

export function makeCascadeDiffStaleWarning(): OkrWarning {
  return { code: 'CASCADE_DIFF_STALE' as OkrWarningCode, message: '级联差异已过期，请重新生成' }
}

// ─── Cascade/Alignment Fixture Builders ─────────────────────────────────────

export function makeOkrCascadePlan(overrides: Partial<OkrCascadePlan> = {}): OkrCascadePlan {
  return {
    id: 1,
    organizationId: 1,
    sourceObjectiveId: 1,
    cycleId: 1,
    title: '组织战略级联拆解',
    description: '从组织级目标拆解到团队/项目目标',
    status: 'draft',
    coverage: 'partial',
    warnings: [],
    assumptions: ['基于当前组织数据生成'],
    sourceRefs: ['组织上下文', 'OKR 周期 Q3'],
    metricVersion: OKR_METRIC_VERSION,
    revisionHash: okrStableHash('cascade:1:1:v1'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrCascadePlanItem(
  overrides: Partial<OkrCascadePlanItem> = {},
): OkrCascadePlanItem {
  return {
    id: 1,
    planId: 1,
    organizationId: 1,
    candidateObjective: {
      title: '团队级目标草案',
      description: '从组织目标拆解的团队级目标',
      scope: 'team',
      confidence: 'medium',
      keyResults: [],
    },
    status: 'pending',
    coverageGap: false,
    conflictWarning: null,
    rejectionReason: null,
    confirmedObjectiveId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeOkrObjectiveRelation(
  overrides: Partial<OkrObjectiveRelation> = {},
): OkrObjectiveRelation {
  return {
    id: 1,
    organizationId: 1,
    sourceObjectiveId: 1,
    targetObjectiveId: 2,
    relationType: 'supports',
    status: 'active',
    impactWeight: 1,
    reasonCode: null,
    evidenceRefHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

export function makeOkrAlignmentHealth(
  overrides: Partial<OkrAlignmentHealth> = {},
): OkrAlignmentHealth {
  return {
    objectiveId: 1,
    score: 85,
    level: 'healthy',
    warnings: [],
    impactSummary: '有父级对齐；2 个子目标',
    metricVersion: OKR_METRIC_VERSION,
    calculatedAt: new Date().toISOString(),
    freshness: { source: 'okr', lastUpdatedAt: new Date().toISOString(), stale: false },
    redactedCount: 0,
    ...overrides,
  }
}

export function makeOkrAlignmentMatrixRow(
  overrides: Partial<OkrAlignmentMatrixRow> = {},
): OkrAlignmentMatrixRow {
  return {
    objectiveId: 1,
    objectiveTitle: '组织级战略目标',
    scope: 'organization',
    ownerId: null,
    status: 'active',
    relations: [],
    parentAlignmentId: null,
    childCount: 2,
    restricted: false,
    ...overrides,
  }
}

export function makeOkrCascadeConfirmationDiff(
  overrides: Partial<OkrCascadeConfirmationDiff> = {},
): OkrCascadeConfirmationDiff {
  return {
    itemId: 1,
    kind: 'objective',
    before: null,
    after: { title: '新团队目标', scope: 'team' },
    warnings: [],
    ...overrides,
  }
}

export function makeOkrAiCascadeSuggestionResponse(
  overrides: Partial<OkrAiCascadeSuggestionResponse> = {},
): OkrAiCascadeSuggestionResponse {
  return {
    cascadeCandidates: [
      {
        title: 'AI 建议：团队级目标',
        description: '从组织战略拆解的团队目标',
        scope: 'team',
        confidence: 'medium',
        keyResults: [
          {
            title: '团队关键结果',
            description: '团队级别的可度量结果',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 0,
            targetValue: 100,
            confidence: 'medium',
          },
        ],
        alignment: { parentObjectiveTitle: '组织战略目标', rationale: '团队执行是战略落地的关键' },
      },
    ],
    relationSuggestions: [],
    conflictExplanations: [],
    missingAlignmentPrompts: ['项目级目标尚未对齐组织战略'],
    confidence: 'medium',
    assumptions: ['基于当前组织 OKR 数据', '假设团队资源配置不变'],
    sourceRefs: ['组织 OKR 周期', '项目列表'],
    warnings: [],
    ...overrides,
  }
}

/** 级联计划 fixture（有效草案） */
export function makeValidCascadePlanFixture(organizationId = 1) {
  const cycle = makeOkrCycle({ id: 1, organizationId })
  const sourceObjective = makeOkrObjective({
    id: 1,
    organizationId,
    cycleId: 1,
    scope: 'organization',
  })
  const plan = makeOkrCascadePlan({ id: 1, organizationId, sourceObjectiveId: 1, cycleId: 1 })
  const items = [
    makeOkrCascadePlanItem({
      id: 1,
      planId: 1,
      organizationId,
      candidateObjective: {
        title: '团队级拆解目标',
        description: '对应组织战略的团队目标',
        scope: 'team',
        confidence: 'high',
        keyResults: [
          {
            title: '团队 KR1',
            description: '',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 0,
            targetValue: 100,
            confidence: 'medium',
          },
        ],
        alignment: { parentObjectiveTitle: '组织战略目标', rationale: '直接支持组织战略' },
      },
    }),
    makeOkrCascadePlanItem({
      id: 2,
      planId: 1,
      organizationId,
      candidateObjective: {
        title: '项目级拆解目标',
        description: '项目维度的目标',
        scope: 'project',
        confidence: 'medium',
        keyResults: [],
        alignment: { parentObjectiveTitle: '组织战略目标', rationale: '项目执行支撑组织目标' },
      },
    }),
  ]
  return { cycle, sourceObjective, plan, items }
}

/** 无效 scope candidate fixture（个人 scope 写入） */
export function makeInvalidScopeCascadeFixture(organizationId = 1) {
  const base = makeValidCascadePlanFixture(organizationId)
  const invalidItem = makeOkrCascadePlanItem({
    id: 3,
    planId: 1,
    organizationId,
    candidateObjective: {
      title: '个人级拆解目标',
      description: '个人级别的目标 — 当前禁用',
      scope: 'individual',
      confidence: 'low',
      keyResults: [],
    },
    conflictWarning: 'individual scope 当前默认禁用写入',
  })
  return { ...base, items: [...base.items, invalidItem] }
}

/** 关系矩阵 fixture */
export function makeRelationMatrixFixture(organizationId = 1) {
  const objectives = [
    makeOkrObjective({ id: 1, organizationId, title: '组织战略目标', scope: 'organization' }),
    makeOkrObjective({ id: 2, organizationId, title: '团队A目标', scope: 'team' }),
    makeOkrObjective({ id: 3, organizationId, title: '团队B目标', scope: 'team' }),
    makeOkrObjective({ id: 4, organizationId, title: '项目X目标', scope: 'project' }),
  ]
  const relations = [
    makeOkrObjectiveRelation({
      id: 1,
      organizationId,
      sourceObjectiveId: 2,
      targetObjectiveId: 3,
      relationType: 'supports',
    }),
    makeOkrObjectiveRelation({
      id: 2,
      organizationId,
      sourceObjectiveId: 4,
      targetObjectiveId: 1,
      relationType: 'contributes_to',
    }),
  ]
  const matrixRows: OkrAlignmentMatrixRow[] = objectives.map((obj) => ({
    objectiveId: obj.id,
    objectiveTitle: obj.title,
    scope: obj.scope,
    ownerId: obj.ownerId,
    status: obj.status,
    health:
      obj.id === 1
        ? makeOkrAlignmentHealth({ objectiveId: 1, score: 90, level: 'healthy' })
        : obj.id === 2
          ? makeOkrAlignmentHealth({ objectiveId: 2, score: 65, level: 'needs_attention' })
          : undefined,
    relations: relations.filter(
      (r) => r.sourceObjectiveId === obj.id || r.targetObjectiveId === obj.id,
    ),
    parentAlignmentId: obj.id !== 1 ? 1 : null,
    childCount: obj.id === 1 ? 3 : 0,
    restricted: false,
  }))
  return { objectives, relations, matrixRows }
}

/** 受限关系投影 fixture */
export function makeRestrictedRelationFixture(organizationId = 1) {
  const matrix = makeRelationMatrixFixture(organizationId)
  // 标记第 3 个 objective 为受限
  if (matrix.matrixRows[2]) {
    matrix.matrixRows[2] = {
      ...matrix.matrixRows[2],
      restricted: true,
      health: undefined,
    }
  }
  matrix.matrixRows.forEach((row) => {
    if (row.relations.some((r) => r.sourceObjectiveId === 3 || r.targetObjectiveId === 3)) {
      row.relations = row.relations.map((r) => ({
        ...r,
        status: 'archived' as OkrRelationStatus,
      }))
    }
  })
  return matrix
}

/** 陈旧健康度 fixture */
export function makeStaleHealthFixture(organizationId = 1) {
  const staleDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() // 3 天前
  const health = makeOkrAlignmentHealth({
    objectiveId: 1,
    score: 40,
    level: 'at_risk',
    freshness: { source: 'okr', lastUpdatedAt: staleDate, stale: true },
    warnings: [{ code: 'STALE_EVIDENCE', message: '证据可能已过期' }],
  })
  return { organizationId, health }
}

/** AI 建议预览 fixture */
export function makeAiAlignmentSuggestionFixture(organizationId = 1) {
  const cycle = makeOkrCycle({ id: 1, organizationId })
  const suggestions = makeOkrAiCascadeSuggestionResponse({
    cascadeCandidates: [
      {
        title: 'AI 建议：提升跨团队协作',
        description: '根据当前目标间缺少支持关系的情况，建议增加跨团队协作目标',
        scope: 'team',
        confidence: 'high',
        keyResults: [
          {
            title: '跨团队项目按时交付率 ≥ 90%',
            description: '',
            measurementType: 'percent',
            unitLabel: '%',
            baselineValue: 70,
            targetValue: 90,
            confidence: 'medium',
          },
        ],
        alignment: {
          parentObjectiveTitle: '组织战略目标',
          rationale: '跨团队协作是组织级战略落地的基础',
        },
      },
    ],
    relationSuggestions: [
      {
        sourceObjectiveTitle: '团队A目标',
        targetObjectiveTitle: '团队B目标',
        relationType: 'supports',
        rationale: '团队A的交付物是团队B的上游输入',
        confidence: 'high',
        impactWeight: 1,
      },
    ],
    conflictExplanations: [
      {
        objectiveTitles: ['团队A目标', '项目X目标'],
        conflictType: '资源竞争',
        explanation: '两个目标在同一时间窗口内需要相同的核心资源',
        severity: 'medium',
        suggestion: '建议调整时间窗口或增加资源配置',
      },
    ],
    missingAlignmentPrompts: ['项目Y尚未创建任何目标对齐'],
  })
  return { cycle, suggestions, organizationId }
}

/** Local fallback fixture：离线或缓存降级场景 */
export function makeLocalFallbackOkrFixture(organizationId = 1) {
  const cycle = makeOkrCycle({ id: 1, organizationId, title: '离线缓存数据' })
  const obj = makeOkrObjective({
    id: 1,
    organizationId,
    cycleId: 1,
    title: '缓存目标（可能已过期）',
    confidence: 'low',
  })
  return {
    cycles: [cycle],
    objectives: [obj],
    keyResults: [],
    alignments: [],
    evidenceLinks: [],
    warnings: [{ code: 'CACHE_DEGRADED' as const, message: '缓存服务降级，结果可能不是最新' }],
  }
}
