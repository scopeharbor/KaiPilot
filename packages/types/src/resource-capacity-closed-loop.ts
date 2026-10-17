// @aiproj/types —— 资源容量预测闭环共享契约（前后端共享，零运行时依赖）。
// v3-resource-capacity-forecasting-closed-loop §2.1：
//   loop / snapshot / scenario / simulation / suggestion / selection / handoff /
//   observation / review、分页 envelope、封闭状态、overlay union、warning/reason、
//   redaction、comparability 与 action posture 契约。
//
// 红线：
//   - 闭环不拥有正式资源事实；快照只是有界业务投影，不是第二权威模型。
//   - 所有数量/字节/日期窗口上限为封闭预算，超界必须 VALIDATION_ERROR。
//   - demand 与 allocation 永远是独立字段，不得互相替代。
//   - 缺失/受限来源显式标记，不得补零或编造标签。
//   - 本文件零运行时依赖，纯 TypeScript 类型 + 常量表。

// ─── 稳定码命名空间 ──────────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_METRIC_VERSION = 'resource-capacity-loop@1' as const

/** 闭环引擎版本——进入 simulationDigest 绑定。 */
export const RESOURCE_CAPACITY_LOOP_ENGINE_VERSION = 'rccl-engine@1' as const

// ─── 生命周期封闭状态 ────────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_STATES = {
  DRAFT: 'draft',
  SIMULATED: 'simulated',
  SELECTED: 'selected',
  HANDED_OFF: 'handed-off',
  OBSERVING: 'observing',
  REVIEWED: 'reviewed',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
} as const

export type ResourceCapacityLoopState =
  (typeof RESOURCE_CAPACITY_LOOP_STATES)[keyof typeof RESOURCE_CAPACITY_LOOP_STATES]

export const RESOURCE_CAPACITY_LOOP_STATE_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_STATES,
) as readonly ResourceCapacityLoopState[]

/** 终态集合：closed 与 cancelled 不接受任何出边。 */
export const RESOURCE_CAPACITY_LOOP_TERMINAL_STATES: readonly ResourceCapacityLoopState[] = [
  RESOURCE_CAPACITY_LOOP_STATES.CLOSED,
  RESOURCE_CAPACITY_LOOP_STATES.CANCELLED,
]

/**
 * 合法状态迁移表（确定性、版本受检）：
 * - 任意非终态 → cancelled；
 * - selected 因 stale 失效可回退 simulated（重新模拟后须重新人工选择）；
 * - closed 不可重开。
 */
export const RESOURCE_CAPACITY_LOOP_ALLOWED_TRANSITIONS: Readonly<
  Record<ResourceCapacityLoopState, readonly ResourceCapacityLoopState[]>
> = {
  draft: [RESOURCE_CAPACITY_LOOP_STATES.SIMULATED, RESOURCE_CAPACITY_LOOP_STATES.CANCELLED],
  simulated: [
    RESOURCE_CAPACITY_LOOP_STATES.SELECTED,
    RESOURCE_CAPACITY_LOOP_STATES.DRAFT,
    RESOURCE_CAPACITY_LOOP_STATES.CANCELLED,
  ],
  selected: [
    RESOURCE_CAPACITY_LOOP_STATES.HANDED_OFF,
    RESOURCE_CAPACITY_LOOP_STATES.SIMULATED,
    RESOURCE_CAPACITY_LOOP_STATES.CANCELLED,
  ],
  'handed-off': [RESOURCE_CAPACITY_LOOP_STATES.OBSERVING, RESOURCE_CAPACITY_LOOP_STATES.CANCELLED],
  observing: [RESOURCE_CAPACITY_LOOP_STATES.REVIEWED, RESOURCE_CAPACITY_LOOP_STATES.CANCELLED],
  reviewed: [RESOURCE_CAPACITY_LOOP_STATES.CLOSED, RESOURCE_CAPACITY_LOOP_STATES.CANCELLED],
  closed: [],
  cancelled: [],
}

// ─── 有界预算（observation-and-inventory.md §1.3 固化值）─────────────────────

export const RESOURCE_CAPACITY_LOOP_BUDGETS = {
  /** 最大预测视界：52 个 week-bucket（或等价 12 个 month-bucket）。 */
  MAX_HORIZON_WEEK_BUCKETS: 52,
  MAX_HORIZON_MONTH_BUCKETS: 12,
  /** 单 loop 可见项目 scope 上限。 */
  MAX_PROJECT_SCOPE: 1000,
  /** 情景数下限/上限（spec 强制 2–5）。 */
  MIN_SCENARIOS: 2,
  MAX_SCENARIOS: 5,
  /** 单情景 overlay 上限。 */
  MAX_OVERLAYS_PER_SCENARIO: 20,
  /** 单 baseline 总 fact 上限。 */
  MAX_FACTS_PER_BASELINE: 20000,
  /** 单 snapshot evidence/ref 上限。 */
  MAX_REFS_PER_SNAPSHOT: 5000,
  /** snapshot 序列化字节上限（2 MiB）。 */
  MAX_PAYLOAD_BYTES: 2 * 1024 * 1024,
  /** 列表分页上限。 */
  MAX_PAGE_SIZE: 50,
  /** superseded snapshot 默认保留天数。 */
  SUPERSEDED_RETENTION_DAYS: 90,
  /** 单来源读取超时与总收集预算。 */
  SOURCE_TIMEOUT_MS: 10_000,
  TOTAL_COLLECTION_BUDGET_MS: 30_000,
  /** selection 过期时间（小时）。 */
  SELECTION_EXPIRY_HOURS: 72,
} as const

// ─── 时间粒度与单位 ──────────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_GRANULARITIES = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
} as const

export type ResourceCapacityLoopGranularity =
  (typeof RESOURCE_CAPACITY_LOOP_GRANULARITIES)[keyof typeof RESOURCE_CAPACITY_LOOP_GRANULARITIES]

export const RESOURCE_CAPACITY_LOOP_GRANULARITY_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_GRANULARITIES,
) as readonly ResourceCapacityLoopGranularity[]

/** canonical 数值统一为小时；计数/百分比仅作为来源侧展示字段保留。 */
export const RESOURCE_CAPACITY_LOOP_UNIT = 'hours' as const

/** 数值精度：canonical packet 内一律四舍五入到 2 位小数。 */
export const RESOURCE_CAPACITY_LOOP_DECIMAL_PRECISION = 2

// ─── 来源可见性 / redaction / freshness 状态 ────────────────────────────────

/** 维度事实的呈现状态：缺失/受限/过期绝不补零。 */
export const RESOURCE_CAPACITY_LOOP_FACT_STATES = {
  VISIBLE: 'visible',
  REDACTED: 'redacted',
  MISSING: 'missing',
  STALE: 'stale',
} as const

export type ResourceCapacityLoopFactState =
  (typeof RESOURCE_CAPACITY_LOOP_FACT_STATES)[keyof typeof RESOURCE_CAPACITY_LOOP_FACT_STATES]

export const RESOURCE_CAPACITY_LOOP_FACT_STATE_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_FACT_STATES,
) as readonly ResourceCapacityLoopFactState[]

// ─── 稳定 reason 码（fail-closed 错误语义）──────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_REASON_CODES = {
  SOURCE_REQUIRED_FAILED: 'RCCL_SOURCE_REQUIRED_FAILED',
  SOURCE_OPTIONAL_DEGRADED: 'RCCL_SOURCE_OPTIONAL_DEGRADED',
  SOURCE_STALE: 'RCCL_SOURCE_STALE',
  PERMISSION_CHANGED: 'RCCL_PERMISSION_CHANGED',
  REVISION_CONFLICT: 'RCCL_REVISION_CONFLICT',
  SELECTION_EXPIRED: 'RCCL_SELECTION_EXPIRED',
  SELECTION_STALE: 'RCCL_SELECTION_STALE',
  NOT_COMPARABLE_METRIC_VERSION: 'RCCL_NOT_COMPARABLE_METRIC_VERSION',
  NOT_COMPARABLE_WINDOW: 'RCCL_NOT_COMPARABLE_WINDOW',
  NOT_COMPARABLE_GRANULARITY: 'RCCL_NOT_COMPARABLE_GRANULARITY',
  NOT_COMPARABLE_SCOPE: 'RCCL_NOT_COMPARABLE_SCOPE',
  HANDOFF_TARGET_UNKNOWN: 'RCCL_HANDOFF_TARGET_UNKNOWN',
  HANDOFF_IDEMPOTENCY_CONFLICT: 'RCCL_HANDOFF_IDEMPOTENCY_CONFLICT',
  BUDGET_EXCEEDED: 'RCCL_BUDGET_EXCEEDED',
  PAYLOAD_TOO_LARGE: 'RCCL_PAYLOAD_TOO_LARGE',
  NON_HUMAN_ACTOR_REJECTED: 'RCCL_NON_HUMAN_ACTOR_REJECTED',
} as const

export type ResourceCapacityLoopReasonCode =
  (typeof RESOURCE_CAPACITY_LOOP_REASON_CODES)[keyof typeof RESOURCE_CAPACITY_LOOP_REASON_CODES]

export const RESOURCE_CAPACITY_LOOP_REASON_CODE_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_REASON_CODES,
) as readonly ResourceCapacityLoopReasonCode[]

// ─── 稳定 warning 码 ─────────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_WARNING_CODES = {
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_DEGRADED: 'SOURCE_DEGRADED',
  SOURCE_TRUNCATED: 'SOURCE_TRUNCATED',
  PARTIAL_VISIBILITY: 'PARTIAL_VISIBILITY',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  CANDIDATE_DEGRADED: 'CANDIDATE_DEGRADED',
  CANDIDATE_SKILL_SHORTFALL: 'CANDIDATE_SKILL_SHORTFALL',
  CANDIDATE_AVAILABILITY_CONFLICT: 'CANDIDATE_AVAILABILITY_CONFLICT',
  OVERLAY_HYPOTHETICAL: 'OVERLAY_HYPOTHETICAL',
} as const

export type ResourceCapacityLoopWarningCode =
  (typeof RESOURCE_CAPACITY_LOOP_WARNING_CODES)[keyof typeof RESOURCE_CAPACITY_LOOP_WARNING_CODES]

export const RESOURCE_CAPACITY_LOOP_WARNING_CODE_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_WARNING_CODES,
) as readonly ResourceCapacityLoopWarningCode[]

/** warning 中文标签（简体中文一等公民）。 */
export const RESOURCE_CAPACITY_LOOP_WARNING_LABELS: Record<
  ResourceCapacityLoopWarningCode,
  string
> = {
  SOURCE_STALE: '来源已过期',
  SOURCE_DEGRADED: '来源降级',
  SOURCE_TRUNCATED: '结果被截断',
  PARTIAL_VISIBILITY: '部分数据不可见',
  LOW_CONFIDENCE: '置信度较低',
  CANDIDATE_DEGRADED: '候选来源不可用',
  CANDIDATE_SKILL_SHORTFALL: '候选技能不足',
  CANDIDATE_AVAILABILITY_CONFLICT: '候选存在可用性冲突',
  OVERLAY_HYPOTHETICAL: '假设性输入（非事实）',
}

// ─── Overlay Union（封闭，禁止扩展）────────────────────────────────────────

/** project-scope：只在当前可见项目集内 include/exclude。 */
export interface ResourceCapacityLoopOverlayProjectScope {
  kind: 'project-scope'
  includeProjectIds: number[]
  excludeProjectIds: number[]
}

/** demand-shift：把某可见项目的既有需求引用在 bucket 间偏移（不改任务日期）。 */
export interface ResourceCapacityLoopOverlayDemandShift {
  kind: 'demand-shift'
  projectId: number
  requirementRefId: string
  fromBucket: string
  toBucket: string
}

/** capacity-delta：按 role 或 normalized skill + bucket 增减假设容量（hours）。 */
export interface ResourceCapacityLoopOverlayCapacityDelta {
  kind: 'capacity-delta'
  role: string | null
  normalizedSkillKey: string | null
  bucket: string
  deltaHours: number
}

/** allocation-preview-ref：引用当前授权的既有调配预览并投影其预期影响。 */
export interface ResourceCapacityLoopOverlayAllocationPreviewRef {
  kind: 'allocation-preview-ref'
  previewRefId: string
}

export type ResourceCapacityLoopOverlay =
  | ResourceCapacityLoopOverlayProjectScope
  | ResourceCapacityLoopOverlayDemandShift
  | ResourceCapacityLoopOverlayCapacityDelta
  | ResourceCapacityLoopOverlayAllocationPreviewRef

export const RESOURCE_CAPACITY_LOOP_OVERLAY_KINDS = [
  'project-scope',
  'demand-shift',
  'capacity-delta',
  'allocation-preview-ref',
] as const

export type ResourceCapacityLoopOverlayKind = (typeof RESOURCE_CAPACITY_LOOP_OVERLAY_KINDS)[number]

// ─── Canonical Planning Packet ──────────────────────────────────────────────

/** 单个维度键下的容量×技能×时间桶事实行。 */
export interface ResourceCapacityLoopPacketFact {
  /** 封闭维度：role / skill / project / timeBucket 组合键的一部分。 */
  dimension: 'role' | 'skill' | 'project'
  /** role 名或 normalized skill key 或项目 id 字符串。 */
  dimensionKey: string
  /** 规范化日期桶（YYYY-MM-DD 对齐粒度起点）。 */
  bucket: string
  /** 计划需求（来自 requirements/预测），永不与分配混写。 */
  demandHours: number
  /** 实际分配（来自 allocations），永不与需求混写。 */
  allocatedHours: number
  /** 可用容量（容量画像 − 可用性例外）。 */
  availableCapacityHours: number
  /** 剩余容量 = 可用容量 − 分配。 */
  remainingCapacityHours: number
  /** 预测缺口 = max(0, 需求 − 分配)（来源权威值优先，此处仅投影）。 */
  gapHours: number
  factState: ResourceCapacityLoopFactState
}

/** 技能覆盖条目：normalized key + 原标签引用分离。 */
export interface ResourceCapacityLoopPacketSkillEntry {
  normalizedSkillKey: string
  originalLabels: string[]
  proficiencyLevel: number | null
  coveredResourceCount: number | null
  factState: ResourceCapacityLoopFactState
}

/** 低敏证据引用：只存 hash/key/授权 id，不含正文。 */
export interface ResourceCapacityLoopEvidenceRef {
  evidenceKey: string
  sourceId: string
  refHash: string
}

/** 单一来源摘要。 */
export interface ResourceCapacityLoopSourceSummary {
  sourceId: string
  sourceVersion: string
  signature: string
  /** required 来源失败/受限 → 基线不可模拟；optional 来源失败只降级。 */
  required: boolean
  freshness: {
    generatedAt: string
    stale: boolean
  }
  factState: ResourceCapacityLoopFactState
  warnings: ResourceCapacityLoopWarningCode[]
  truncated: boolean
}

/** 权限指纹输入摘要（不含任何隐藏实体标识）。 */
export interface ResourceCapacityLoopPermissionDigestInput {
  organizationId: number
  visibleProjectIdsHash: string
  resourceVisibilityHash: string
  memberVisibilityHash: string
  skillVisibilityHash: string
}

export interface ResourceCapacityLoopScope {
  granularity: ResourceCapacityLoopGranularity
  windowStart: string
  windowEnd: string
  projectIds: number[]
}

/**
 * canonical planning packet：五类来源权威结果的单位/窗口/粒度对齐投影。
 * `collectedAt` 仅审计用，绝不参与 content digest。
 */
export interface ResourceCapacityLoopCanonicalPacket {
  schemaVersion: typeof RESOURCE_CAPACITY_LOOP_METRIC_VERSION
  scope: ResourceCapacityLoopScope
  unit: typeof RESOURCE_CAPACITY_LOOP_UNIT
  facts: ResourceCapacityLoopPacketFact[]
  skillEntries: ResourceCapacityLoopPacketSkillEntry[]
  sources: ResourceCapacityLoopSourceSummary[]
  evidenceRefs: ResourceCapacityLoopEvidenceRef[]
  warnings: ResourceCapacityLoopWarningCode[]
  /** readiness：required 全绿才可模拟。 */
  readyForSimulation: boolean
}

// ─── Baseline Snapshot ──────────────────────────────────────────────────────

export interface ResourceCapacityLoopBaselineSnapshotDTO {
  id: string
  loopId: string
  organizationId: number
  revision: number
  packet: ResourceCapacityLoopCanonicalPacket
  baselineDigest: string
  permissionFingerprint: string
  createdAt: string
  supersededBy: string | null
}

// ─── Scenario / Simulation ──────────────────────────────────────────────────

export interface ResourceCapacityLoopScenarioDTO {
  id: string
  loopId: string
  organizationId: number
  name: string
  baselineId: string
  overlays: ResourceCapacityLoopOverlay[]
  revision: number
  active: boolean
  createdAt: string
  updatedAt: string
}

/** 模拟输出行：与 packet 同单位/粒度。 */
export interface ResourceCapacityLoopSimulationRow extends ResourceCapacityLoopPacketFact {
  hypothetical: boolean
}

export interface ResourceCapacityLoopSimulationDeltaSummary {
  gapDeltaHours: number
  contentionDeltaCount: number
  coverageDeltaHours: number
}

export interface ResourceCapacityLoopSimulationSnapshotDTO {
  id: string
  scenarioId: string
  loopId: string
  organizationId: number
  engineVersion: typeof RESOURCE_CAPACITY_LOOP_ENGINE_VERSION
  scenarioRevision: number
  rows: ResourceCapacityLoopSimulationRow[]
  delta: ResourceCapacityLoopSimulationDeltaSummary
  confidenceBand: 'high' | 'medium' | 'low'
  warnings: ResourceCapacityLoopWarningCode[]
  simulationDigest: string
  createdAt: string
}

// ─── Allocation Suggestion（advisory 投影）─────────────────────────────────

export interface ResourceCapacityLoopSuggestionCandidateProjection {
  candidateRefId: string
  resourceId: number
  resourceName: string
  matcherProvenance: string
  existingScore: number | null
  matchedSkillKeys: string[]
  missingSkillKeys: string[]
  coveredHoursPerBucket: Array<{ bucket: string; coveredHours: number }>
  uncoveredHoursPerBucket: Array<{ bucket: string; uncoveredHours: number }>
  availabilityConflictBuckets: string[]
  contentionSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none'
  freshnessStale: boolean
  evidenceRefs: ResourceCapacityLoopEvidenceRef[]
}

export interface ResourceCapacityLoopAllocationSuggestionDTO {
  id: string
  loopId: string
  organizationId: number
  unmetDimension: 'role' | 'skill'
  unmetDimensionKey: string
  unmetBuckets: Array<{ bucket: string; unmetHours: number }>
  candidates: ResourceCapacityLoopSuggestionCandidateProjection[]
  degraded: boolean
  /** 恒为 true：建议只读投影，绝不自动应用。 */
  advisoryOnly: true
  /** 恒为 false：闭环从不直接写正式分配。 */
  applied: false
  /** 恒为 true：落库须经下游 preview + 显式确认。 */
  confirmationRequired: true
  createdAt: string
}

// ─── Selection（仅人类）────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_ACTOR_TYPES = {
  HUMAN_USER: 'human_user',
} as const

export type ResourceCapacityLoopActorType =
  (typeof RESOURCE_CAPACITY_LOOP_ACTOR_TYPES)[keyof typeof RESOURCE_CAPACITY_LOOP_ACTOR_TYPES]

export const RESOURCE_CAPACITY_LOOP_REJECTED_ACTOR_TYPES = [
  'rule',
  'plugin',
  'ai',
  'scheduled_job',
  'confidence_threshold',
] as const

export type ResourceCapacityLoopRejectedActorType =
  (typeof RESOURCE_CAPACITY_LOOP_REJECTED_ACTOR_TYPES)[number]

export interface ResourceCapacityLoopSelectionDTO {
  id: string
  loopId: string
  organizationId: number
  scenarioId: string
  simulationSnapshotId: string
  actorUserId: number
  acknowledgedWarnings: ResourceCapacityLoopWarningCode[]
  selectionFingerprint: string
  boundBaselineDigest: string
  boundSimulationDigest: string
  boundSourceSignaturesHash: string
  boundPermissionFingerprint: string
  boundLoopRevision: number
  expiresAt: string
  createdAt: string
}

// ─── Handoff Receipt ────────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS = {
  CROSS_PROJECT_ALLOCATION_DRAFT: 'cross-project-allocation-draft',
  PROJECT_RESOURCE_SUGGESTION_PREVIEW: 'project-resource-suggestion-preview',
  SAFE_NAVIGATION: 'safe-navigation',
} as const

export type ResourceCapacityLoopHandoffTarget =
  (typeof RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS)[keyof typeof RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS]

export const RESOURCE_CAPACITY_LOOP_HANDOFF_TARGET_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS,
) as readonly ResourceCapacityLoopHandoffTarget[]

/** 下游状态投影：下游 confirmed ≠ loop applied。 */
export const RESOURCE_CAPACITY_LOOP_HANDOFF_STATUSES = {
  PENDING: 'pending',
  PREVIEWED: 'previewed',
  CONFIRMED_DOWNSTREAM: 'confirmed_downstream',
  APPLIED_DOWNSTREAM: 'applied_downstream',
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const

export type ResourceCapacityLoopHandoffStatus =
  (typeof RESOURCE_CAPACITY_LOOP_HANDOFF_STATUSES)[keyof typeof RESOURCE_CAPACITY_LOOP_HANDOFF_STATUSES]

export const RESOURCE_CAPACITY_LOOP_HANDOFF_STATUS_VALUES = Object.values(
  RESOURCE_CAPACITY_LOOP_HANDOFF_STATUSES,
) as readonly ResourceCapacityLoopHandoffStatus[]

export interface ResourceCapacityLoopHandoffReceiptDTO {
  id: string
  loopId: string
  organizationId: number
  selectionId: string
  target: ResourceCapacityLoopHandoffTarget
  /** 幂等键哈希（org + selectionFingerprint + target + key），原文不入库。 */
  idempotencyHash: string
  pendingRefId: string | null
  status: ResourceCapacityLoopHandoffStatus
  statusReason: string | null
  /** 恒为 false：handoff 本身零正式写入。 */
  writesApplied: false
  /** 恒为 true：下游须再次预览 + 显式确认。 */
  confirmationRequired: true
  sourceSignaturesHash: string
  createdAt: string
  updatedAt: string
}

// ─── Observation / Comparability ────────────────────────────────────────────

export interface ResourceCapacityLoopObservedRow {
  dimension: ResourceCapacityLoopPacketFact['dimension']
  dimensionKey: string
  bucket: string
  observedGapHours: number
  observedAllocatedHours: number
  factState: ResourceCapacityLoopFactState
}

export interface ResourceCapacityLoopBucketComparison {
  dimension: ResourceCapacityLoopPacketFact['dimension']
  dimensionKey: string
  bucket: string
  baselineGapHours: number
  expectedGapHours: number | null
  observedGapHours: number | null
  forecastErrorHours: number | null
  unresolved: boolean
}

export interface ResourceCapacityLoopComparabilityResult {
  comparable: boolean
  reasonCodes: ResourceCapacityLoopReasonCode[]
}

export interface ResourceCapacityLoopObservationSnapshotDTO {
  id: string
  loopId: string
  organizationId: number
  downstreamStatus: ResourceCapacityLoopHandoffStatus
  comparability: ResourceCapacityLoopComparabilityResult
  comparisons: ResourceCapacityLoopBucketComparison[]
  appliedItemRefs: string[]
  failedItemRefs: string[]
  unrelatedChangeNotes: string[]
  observationDigest: string
  createdAt: string
}

// ─── Review ────────────────────────────────────────────────────────────────

export const RESOURCE_CAPACITY_LOOP_REVIEW_OUTCOMES = {
  GOAL_MET: 'goal_met',
  PARTIALLY_MET: 'partially_met',
  NOT_MET: 'not_met',
  INVALIDATED: 'invalidated',
} as const

export type ResourceCapacityLoopReviewOutcome =
  (typeof RESOURCE_CAPACITY_LOOP_REVIEW_OUTCOMES)[keyof typeof RESOURCE_CAPACITY_LOOP_REVIEW_OUTCOMES]

export interface ResourceCapacityLoopReviewDTO {
  id: string
  loopId: string
  organizationId: number
  observationSnapshotId: string
  outcome: ResourceCapacityLoopReviewOutcome
  /** 有界结论文本 ≤ 500 字符，审计低敏扫描通过后才可入库。 */
  boundedRationale: string
  actorUserId: number
  createdAt: string
}

// ─── Action Posture（API 统一返回姿态）─────────────────────────────────────

export interface ResourceCapacityLoopActionPosture {
  canSimulate: boolean
  canSelect: boolean
  canHandoff: boolean
  canCaptureObservation: boolean
  canReview: boolean
  readOnly: boolean
  staleReasons: ResourceCapacityLoopReasonCode[]
}

export interface ResourceCapacityLoopFreshnessSummary {
  overallState: ResourceCapacityLoopFactState
  staleSources: string[]
  newestSourceAt: string | null
}

// ─── API Envelope ──────────────────────────────────────────────────────────

export interface ResourceCapacityLoopListItemDTO {
  id: string
  organizationId: number
  title: string
  ownerUserId: number
  state: ResourceCapacityLoopState
  revision: number
  scope: ResourceCapacityLoopScope
  topGap: {
    dimension: ResourceCapacityLoopPacketFact['dimension']
    dimensionKey: string
    bucket: string
    gapHours: number
  } | null
  topMissingSkillKey: string | null
  openConflictCount: number
  freshness: ResourceCapacityLoopFreshnessSummary
  nextAction: ResourceCapacityLoopActionPosture
  createdAt: string
  updatedAt: string
}

export interface ResourceCapacityLoopListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface ResourceCapacityLoopListEnvelope {
  data: ResourceCapacityLoopListItemDTO[]
  meta: ResourceCapacityLoopListMeta
}

export interface ResourceCapacityLoopItemEnvelope<T> {
  data: T
}

/** 创建/更新 loop 的有界请求体。 */
export interface ResourceCapacityLoopCreateInput {
  title: string
  scope: ResourceCapacityLoopScope
}

/** mutation 通用乐观锁要求。 */
export interface ResourceCapacityLoopMutationGuard {
  expectedRevision: number
}
