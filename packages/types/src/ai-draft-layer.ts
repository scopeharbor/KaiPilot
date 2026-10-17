/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer 前后端共享契约。
 *
 * 定义 Draft Layer 完整生命周期的类型、枚举与常量：
 * session（会话）、change（变更项）、preview（预览快照）、diff（差异）、
 * decision（用户决策）、dry-run（演练）、apply result（应用结果）。
 *
 * 纯静态类型 + const 数组，hash 工具函数保持零外部依赖。
 * zod schema 在后端 `services/draft_layer/schema.ts` 定义。
 */

// ---------------------------------------------------------------------------
// 来源类型
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_SOURCE_TYPES = [
  'v2_compiler_pdm',
  'v3_copilot_action',
  'v3_triz_candidate',
] as const
export type DraftLayerSourceType = (typeof DRAFT_LAYER_SOURCE_TYPES)[number]

// ---------------------------------------------------------------------------
// 会话状态机
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_SESSION_STATUSES = [
  'active',
  'previewing',
  'reviewing',
  'applying',
  'applied',
  'discarded',
  'expired',
] as const
export type DraftLayerSessionStatus = (typeof DRAFT_LAYER_SESSION_STATUSES)[number]

// ---------------------------------------------------------------------------
// 变更操作
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_CHANGE_OPERATIONS = ['create', 'update', 'delete'] as const
export type DraftLayerChangeOperation = (typeof DRAFT_LAYER_CHANGE_OPERATIONS)[number]

// ---------------------------------------------------------------------------
// 审查状态
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_REVIEW_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'modified',
  'skipped',
] as const
export type DraftLayerReviewStatus = (typeof DRAFT_LAYER_REVIEW_STATUSES)[number]

// ---------------------------------------------------------------------------
// 冲突严重级别
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_CONFLICT_SEVERITIES = ['none', 'soft', 'hard'] as const
export type DraftLayerConflictSeverity = (typeof DRAFT_LAYER_CONFLICT_SEVERITIES)[number]

// ---------------------------------------------------------------------------
// 应用状态
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_APPLY_STATUSES = [
  'pending',
  'dry_run_passed',
  'applied',
  'failed',
  'rolled_back',
] as const
export type DraftLayerApplyStatus = (typeof DRAFT_LAYER_APPLY_STATUSES)[number]

// ---------------------------------------------------------------------------
// 实体类型（Preview 投影目标）
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_ENTITY_TYPES = [
  'project',
  'wbs_node',
  'task',
  'dependency',
  'milestone',
  'acceptance_criterion',
  'risk',
  'resource',
] as const
export type DraftLayerEntityType = (typeof DRAFT_LAYER_ENTITY_TYPES)[number]

// ---------------------------------------------------------------------------
// Diff 操作类型
// ---------------------------------------------------------------------------

export const DRAFT_LAYER_DIFF_OPERATIONS = [
  'add',
  'modify',
  'remove',
  'unchanged',
  'conflict',
] as const
export type DraftLayerDiffOperation = (typeof DRAFT_LAYER_DIFF_OPERATIONS)[number]

// ---------------------------------------------------------------------------
// Draft Layer Session
// ---------------------------------------------------------------------------

export interface DraftLayerSession {
  id: number
  organizationId: number
  createdByUserId: number
  sourceType: DraftLayerSourceType
  compilerRunId: number | null
  pdmArtifactId: string | null
  pdmHash: string | null
  status: DraftLayerSessionStatus
  version: number
  expiresAt: string | null
  summary: DraftLayerSessionSummary | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string | null
}

export interface DraftLayerSessionSummary {
  compilerRunStatus: string
  ledgerStatus: string
  pdmEntityCount: number
  totalChanges: number
  acceptedChanges: number
  rejectedChanges: number
  pendingChanges: number
  unresolvedConflicts: number
  dryRunStatus: DraftLayerApplyStatus | null
  applyStatus: DraftLayerApplyStatus | null
}

// ---------------------------------------------------------------------------
// Draft Layer Change
// ---------------------------------------------------------------------------

export interface DraftLayerChange {
  id: number
  sessionId: number
  target: DraftLayerChangeTarget
  operation: DraftLayerChangeOperation
  path: string
  value: unknown
  oldValue: unknown | null
  reviewStatus: DraftLayerReviewStatus
  userModifiedValue: unknown | null
  userNote: string | null
  sequence: number
  dependsOn: number[]
  confidence: number
  validationSummary: DraftLayerChangeValidation | null
}

export interface DraftLayerChangeTarget {
  entityType: DraftLayerEntityType
  entityId: string
  fieldPath: string | null
}

export interface DraftLayerChangeValidation {
  blocking: string[]
  warning: string[]
  info: string[]
}

// ---------------------------------------------------------------------------
// Preview Snapshot
// ---------------------------------------------------------------------------

export interface DraftLayerPreview {
  id: number
  sessionId: number
  version: number
  baselineSummary: Record<string, unknown> | null
  currentSummary: Record<string, unknown> | null
  previewHash: string
  computedFromChangeIds: number[]
  validationSummary: DraftLayerPreviewValidation | null
}

export interface DraftLayerPreviewValidation {
  blocking: string[]
  warning: string[]
  info: string[]
}

// ---------------------------------------------------------------------------
// Preview Entity（PDM 到业务实体的投影）
// ---------------------------------------------------------------------------

export interface DraftLayerPreviewEntity {
  tempId: string
  entityType: DraftLayerEntityType
  fields: Record<string, unknown>
  references: DraftLayerEntityReference[]
  lineage: string[]
  aiMarker: DraftLayerAiMarkerSummary | null
  needsConfirmation: boolean
}

export interface DraftLayerEntityReference {
  field: string
  targetTempId: string | null
  targetEntityType: DraftLayerEntityType | null
}

export interface DraftLayerAiMarkerSummary {
  confidence: number
  source: string
  reason: string
  needsConfirmation: boolean
}

// ---------------------------------------------------------------------------
// Diff Result
// ---------------------------------------------------------------------------

export interface DraftLayerDiffResult {
  sessionId: number
  previewHash: string
  baselineVersion: number | null
  currentVersion: number | null
  entities: DraftLayerDiffEntity[]
  entitySummaries: DraftLayerEntityDiffSummary[]
  patchOperations: DraftLayerPatchOperation[]
}

export interface DraftLayerDiffEntity {
  entityType: DraftLayerEntityType
  tempId: string
  operation: DraftLayerDiffOperation
  conflictSeverity: DraftLayerConflictSeverity
  fieldDiffs: DraftLayerFieldDiff[]
}

export interface DraftLayerFieldDiff {
  field: string
  operation: DraftLayerDiffOperation
  baselineValue: unknown | null
  currentValue: unknown | null
  previewValue: unknown | null
  conflict: boolean
  conflictDetails: string | null
}

export interface DraftLayerEntityDiffSummary {
  entityType: DraftLayerEntityType
  added: number
  modified: number
  removed: number
  unchanged: number
  conflicts: number
}

export interface DraftLayerPatchOperation {
  op: 'add' | 'remove' | 'replace'
  path: string
  value: unknown | null
  oldValue: unknown | null
}

// ---------------------------------------------------------------------------
// User Decision
// ---------------------------------------------------------------------------

export interface DraftLayerDecision {
  sessionId: number
  changeId: number
  reviewStatus: DraftLayerReviewStatus
  userModifiedValue: unknown | null
  userNote: string | null
  selectionHash: string
}

export interface DraftLayerBulkDecision {
  sessionId: number
  entityTypes?: DraftLayerEntityType[]
  operations?: DraftLayerChangeOperation[]
  minConfidence?: number
  fieldPattern?: string
  allExcept?: number[]
  action: DraftLayerReviewStatus
}

// ---------------------------------------------------------------------------
// Dry-run & Apply Plan
// ---------------------------------------------------------------------------

export interface DraftLayerDryRunResult {
  sessionId: number
  canApply: boolean
  applyPlanHash: string
  selectionHash: string
  previewHash: string
  entityCounts: DraftLayerApplyEntityCounts
  blocking: string[]
  warnings: string[]
  info: string[]
}

export interface DraftLayerApplyPlan {
  applyPlanHash: string
  selectionHash: string
  previewHash: string
  operations: DraftLayerApplyOperation[]
  entityCounts: DraftLayerApplyEntityCounts
}

export interface DraftLayerApplyOperation {
  entityType: DraftLayerEntityType
  operation: DraftLayerChangeOperation
  fields: Record<string, unknown>
  tempId: string
  order: number
}

export interface DraftLayerApplyEntityCounts {
  projects: number
  wbsNodes: number
  tasks: number
  dependencies: number
  milestones: number
  acceptanceCriteria: number
  risks: number
  resources: number
}

// ---------------------------------------------------------------------------
// Apply Result
// ---------------------------------------------------------------------------

export interface DraftLayerApplyResult {
  id: number
  sessionId: number
  applyPlanHash: string
  selectionHash: string
  status: DraftLayerApplyStatus
  projectId: number | null
  entityCounts: DraftLayerApplyEntityCounts | null
  errorSummary: string | null
  idempotencyKey: string
  appliedAt: string | null
  /**
   * v3-triz-to-delivery-closed-loop —— typed apply entity receipt（task 4.1）。
   *
   * 同事务产出的逐实体 refs：entityType、正式 entityId、源 changeId/tempId。
   * 不复制正式实体正文；历史 apply result 该列为 null → 上层投影为
   * `legacy_unlinked` warning，不做猜测式回填。上限 = operations 数上限。
   */
  entityRefs?: DraftLayerApplyEntityReceipt[] | null
}

/** typed receipt 单条（与 triz-to-delivery-closed-loop.TrizDlApplyEntityReceipt 结构对齐）。 */
export interface DraftLayerApplyEntityReceipt {
  entityType: DraftLayerEntityType
  entityId: string
  sourceChangeId: number
  tempId: string
}

// ---------------------------------------------------------------------------
// PDM Handoff Contract
// ---------------------------------------------------------------------------

export interface DraftLayerPdmHandoff {
  compilerRunId: number
  pdmArtifactId: string
  pdmHash: string
  ledgerSummary: DraftLayerLedgerSummary
  status: 'ready_to_handoff' | 'needs_human_review' | 'blocked'
}

export interface DraftLayerLedgerSummary {
  totalEntities: number
  completedEntities: number
  needsHumanReview: boolean
  blockingItems: string[]
  hasBlockingHumanReview: boolean
}

// ---------------------------------------------------------------------------
// API Request / Response
// ---------------------------------------------------------------------------

export interface DraftLayerCreateRequest {
  compilerRunId: number
}

export interface DraftLayerCreateResponse {
  session: DraftLayerSession
}

export interface DraftLayerPreviewResponse {
  preview: DraftLayerPreview
  entities: DraftLayerPreviewEntity[]
}

export interface DraftLayerDiffResponse {
  diff: DraftLayerDiffResult
}

export interface DraftLayerDecisionRequest {
  changeId: number
  reviewStatus: DraftLayerReviewStatus
  userModifiedValue?: unknown
  userNote?: string
}

export interface DraftLayerBulkDecisionRequest {
  filter: DraftLayerBulkDecision
}

export interface DraftLayerDryRunRequest {
  force?: boolean
}

export interface DraftLayerDryRunResponse {
  result: DraftLayerDryRunResult
}

export interface DraftLayerApplyRequest {
  idempotencyKey: string
}

export interface DraftLayerApplyResponse {
  result: DraftLayerApplyResult
}

export interface DraftLayerDetailResponse {
  session: DraftLayerSession
  changes: DraftLayerChange[]
  preview: DraftLayerPreview | null
  diff: DraftLayerDiffResult | null
  applyResult: DraftLayerApplyResult | null
}

// ---------------------------------------------------------------------------
// Hash 工具函数
// ---------------------------------------------------------------------------

/**
 * 简单 SHA-256 哈希生成（运行时用 Web Crypto API 或 Node crypto）。
 * 此处只定义类型，具体实现在后端服务层。
 */

/** 输入排序 key 的 hash 输入。 */
function sortJson(input: unknown): string {
  return JSON.stringify(input, Object.keys(input as object).sort())
}

/**
 * 计算 preview hash —— 基于 baseline summary + current summary + preview entities。
 * 确定性地保证同一组输入产出相同 hash。
 */
export function computePreviewHash(
  baselineSummary: Record<string, unknown> | null,
  currentSummary: Record<string, unknown> | null,
  entityHashes: string[],
): string {
  const parts = [
    sortJson(baselineSummary ?? {}),
    sortJson(currentSummary ?? {}),
    ...entityHashes.sort(),
  ]
  return simpleHash(parts.join('|'))
}

/**
 * 计算 selection hash —— 基于每项 change 的 reviewStatus + 用户编辑值。
 * changeId 排序保证确定输出。
 */
export function computeSelectionHash(
  decisions: Array<{ changeId: number; reviewStatus: string; userModifiedValue: unknown | null }>,
): string {
  const sorted = [...decisions].sort((a, b) => a.changeId - b.changeId)
  const parts = sorted.map((d) =>
    sortJson({
      changeId: d.changeId,
      reviewStatus: d.reviewStatus,
      userModifiedValue: d.userModifiedValue,
    }),
  )
  return simpleHash(parts.join('|'))
}

/**
 * 计算 apply plan hash —— 基于 selectionHash + previewHash + entity 操作清单。
 */
export function computeApplyPlanHash(
  selectionHash: string,
  previewHash: string,
  operationsDigest: string,
): string {
  return simpleHash(`${selectionHash}|${previewHash}|${operationsDigest}`)
}

/**
 * 构造 apply 幂等键 —— 至少覆盖 sessionId、version、selectionHash、previewHash、applyPlanHash 与 actorId。
 */
export function buildApplyIdempotencyKey(params: {
  sessionId: number
  version: number
  selectionHash: string
  previewHash: string
  applyPlanHash: string
  actorUserId: number
}): string {
  const { sessionId, version, selectionHash, previewHash, applyPlanHash, actorUserId } = params
  return simpleHash(
    `apply:${sessionId}:v${version}:sel=${selectionHash}:prev=${previewHash}:plan=${applyPlanHash}:actor=${actorUserId}`,
  )
}

/**
 * 简单非加密哈希（用于哈希稳定性测试，生产环境应改用 SHA-256）。
 * 确定性：同一输入永远输出同一哈希。
 */
function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // 转换为 32 位整数
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// 测试夹具（fixture）类型
// ---------------------------------------------------------------------------

export interface DraftLayerFixture {
  name: string
  description: string
  pdmInput: Record<string, unknown>
  expectedChanges: number
  expectedEntities: string[]
}
