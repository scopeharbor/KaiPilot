/**
 * OCR Permission & Audit — 共享契约（v3-ocr-permission-and-audit §2）
 *
 * 职责：
 * - OCR 权限动作分类（19 个动作 → 后端权限 / UI 允许动作 / 审计动作 / 读写分类）
 * - 授权决策快照（角色 + 来源 + 生命周期 + 保留/滞留 + 隐私证据）
 * - 权限状态 / 审计摘要 / 审计查询 / 决策预览 / 分页 DTO
 * - 确定性哈希（决策快照 / 审计摘要 / 来源引用 / 内容哈希 / 幂等键）
 * - 低敏感脱敏（移除完整 OCR 文本 / 结构化值 / 搜索片段 / provider 体 / 提示词 / 模型输出 / 密钥 / 授权头 / 绝对路径）
 *
 * 红线：本模块为纯函数共享契约，无 DB / 无 IO / 无真实 provider 调用。
 */
import { redactAuditMetadata } from './ocr-review-confirmation.js'

// ═══════════════════════════════════════════════════════════════════════════════
// 动作分类（spec taxonomy）
// ═══════════════════════════════════════════════════════════════════════════════

export const OCR_PERMISSION_ACTIONS = [
  'metadata_read',
  'candidate_text_read',
  'accepted_text_read',
  'provider_run',
  'review_preview',
  'review_confirm',
  'supersede',
  'retention_hold',
  'retention_cleanup_preview',
  'search_indexing_preview',
  'search_indexing_execution',
  'structured_extraction_run',
  'entity_linking_run',
  'copy_export_preview',
  'copy_export_execution',
  'optional_ai_handoff',
  'explain_request',
  'permission_status_read',
  'ocr_audit_read',
] as const
export type OcrPermissionAction = (typeof OCR_PERMISSION_ACTIONS)[number]

// 决策结果
export const OCR_PERMISSION_DECISION_RESULTS = [
  'allow',
  'confirm_required',
  'degraded',
  'metadata_only',
  'stale_blocked',
  'retention_blocked',
  'privacy_blocked',
  'denied',
] as const
export type OcrPermissionDecisionResult = (typeof OCR_PERMISSION_DECISION_RESULTS)[number]

// 授权来源（grantedPermissionSource）
export const OCR_GRANTED_SOURCES = ['role', 'system_admin_bypass', 'role_version', 'none'] as const
export type OcrGrantedSource = (typeof OCR_GRANTED_SOURCES)[number]

// 输出/脱敏模式
export const OCR_PERMISSION_OUTPUT_MODES = [
  'full',
  'snippet',
  'masked',
  'metadata_only',
  'blocked',
] as const
export type OcrPermissionOutputMode = (typeof OCR_PERMISSION_OUTPUT_MODES)[number]

// 冗余/陈旧状态
export const OCR_STALE_STATUSES = ['current', 'stale', 'unknown'] as const
export type OcrStaleStatus = (typeof OCR_STALE_STATUSES)[number]

// 生命周期状态
export const OCR_LIFECYCLE_STATES = [
  'active',
  'expired',
  'purge_pending',
  'purged',
  'tombstoned',
] as const
export type OcrLifecycleState = (typeof OCR_LIFECYCLE_STATES)[number]

// 保留/滞留状态
export const OCR_RETENTION_STATES = [
  'none',
  'held',
  'expired',
  'purge_pending',
  'purged',
  'tombstoned',
] as const
export type OcrRetentionState = (typeof OCR_RETENTION_STATES)[number]

// 原因码
export const OCR_PERMISSION_REASON_CODES = [
  'role_denied',
  'permission_missing',
  'org_mismatch',
  'project_mismatch',
  'source_hidden',
  'source_not_found',
  'lifecycle_expired',
  'lifecycle_purged',
  'lifecycle_tombstoned',
  'retention_held',
  'retention_purge_pending',
  'stale_source',
  'privacy_blocked',
  'confirmation_required',
  'capability_unavailable',
  'degraded',
  'system_admin_bypass',
] as const
export type OcrPermissionReasonCode = (typeof OCR_PERMISSION_REASON_CODES)[number]

// 审计动作（低敏感）
export const OCR_PERMISSION_AUDIT_ACTIONS = [
  'status_read',
  'sensitive_read',
  'provider_run',
  'review_preview',
  'review_confirm',
  'supersede',
  'retention_hold',
  'cleanup_preview',
  'index_preview',
  'index_execute',
  'structured_run',
  'entity_link_run',
  'export_preview',
  'export_execute',
  'ai_handoff_block',
  'explain_request',
  'stale_block',
  'privacy_block',
  'permission_denial',
] as const
export type OcrPermissionAuditAction = (typeof OCR_PERMISSION_AUDIT_ACTIONS)[number]

// 资源引用类型
export const OCR_RESOURCE_REF_KINDS = ['source', 'artifact', 'job', 'accepted_extraction'] as const
export type OcrResourceRefKind = (typeof OCR_RESOURCE_REF_KINDS)[number]

// 审计事件名（后端 AuditEvent 常量，低敏感）
export const OCR_PERMISSION_AUDIT_EVENTS = [
  'ocr.permission.status_read',
  'ocr.permission.sensitive_read',
  'ocr.permission.provider_run',
  'ocr.permission.review_preview',
  'ocr.permission.review_confirm',
  'ocr.permission.supersede',
  'ocr.permission.retention_hold',
  'ocr.permission.cleanup_preview',
  'ocr.permission.index_preview',
  'ocr.permission.index_execute',
  'ocr.permission.structured_run',
  'ocr.permission.entity_link_run',
  'ocr.permission.export_preview',
  'ocr.permission.export_execute',
  'ocr.permission.ai_handoff_block',
  'ocr.permission.explain_request',
  'ocr.permission.stale_block',
  'ocr.permission.privacy_block',
  'ocr.permission.denial',
] as const
export type OcrPermissionAuditEvent = (typeof OCR_PERMISSION_AUDIT_EVENTS)[number]

// ═══════════════════════════════════════════════════════════════════════════════
// 资源引用类型
// ═══════════════════════════════════════════════════════════════════════════════

export interface OcrActorRef {
  readonly type: 'user'
  readonly id: number
}

export interface OcrOrganizationRef {
  readonly type: 'organization'
  readonly id: number
}

export interface OcrProjectRef {
  readonly type: 'project'
  readonly id: number
}

export interface OcrSourceRef {
  readonly type: 'ocr_source'
  readonly id: number
  readonly kind: string
}

export interface OcrArtifactRef {
  readonly type: 'ocr_artifact'
  readonly id: number | null
  readonly kind: OcrResourceRefKind
}

// ═══════════════════════════════════════════════════════════════════════════════
// 授权决策快照
// ═══════════════════════════════════════════════════════════════════════════════

export interface OcrAuthorizationDecisionSnapshot {
  readonly action: OcrPermissionAction
  readonly result: OcrPermissionDecisionResult
  readonly requiredPermission: string
  readonly grantedPermissionSource: OcrGrantedSource
  readonly roleVersion: number | null
  readonly actorRef: OcrActorRef
  readonly organizationRef: OcrOrganizationRef
  readonly projectRef: OcrProjectRef
  readonly sourceRef: OcrSourceRef | null
  readonly artifactRef: OcrArtifactRef | null
  readonly sourceHash: string | null
  readonly lifecycleState: OcrLifecycleState | null
  readonly retentionState: OcrRetentionState | null
  readonly holdActive: boolean
  readonly staleStatus: OcrStaleStatus
  readonly privacyRef: string | null
  readonly privacyHash: string | null
  readonly outputMode: OcrPermissionOutputMode
  readonly requiresConfirmation: boolean
  readonly reasonCodes: readonly OcrPermissionReasonCode[]
  readonly decisionHash: string
}

// ─── 权限状态 ────────────────────────────────────────────────────────────────

export interface OcrBlockedAction {
  readonly action: OcrPermissionAction
  readonly reasonCodes: readonly OcrPermissionReasonCode[]
  readonly decisionHash: string
}

export interface OcrPermissionStatus {
  readonly projectRef: OcrProjectRef
  readonly sourceRef: OcrSourceRef | null
  readonly artifactRef: OcrArtifactRef | null
  readonly sourceHash: string | null
  readonly lifecycleState: OcrLifecycleState | null
  readonly retentionState: OcrRetentionState | null
  readonly staleStatus: OcrStaleStatus
  readonly outputMode: OcrPermissionOutputMode
  readonly allowedActions: readonly OcrPermissionAction[]
  readonly blockedActions: readonly OcrBlockedAction[]
  readonly decisionHashes: readonly string[]
  readonly warnings: readonly string[]
  readonly statusHash: string
}

// ─── 审计摘要 ────────────────────────────────────────────────────────────────

export interface OcrAuditSummary {
  readonly id: number
  readonly event: OcrPermissionAuditEvent
  readonly action: OcrPermissionAction
  readonly result: OcrPermissionDecisionResult
  readonly reasonCodes: readonly OcrPermissionReasonCode[]
  readonly actorRef: OcrActorRef
  readonly projectRef: OcrProjectRef
  readonly sourceRef: OcrSourceRef | null
  readonly artifactRef: OcrArtifactRef | null
  readonly sourceHash: string | null
  readonly contentHash: string | null
  readonly decisionHash: string | null
  readonly createdAt: string
  readonly metadata: Readonly<Record<string, unknown>>
}

// ─── 审计查询 ────────────────────────────────────────────────────────────────

export interface OcrAuditQuery {
  readonly projectId: number
  readonly sourceRef?: { readonly id: number; readonly kind: string }
  readonly artifactRef?: { readonly id: number | null; readonly kind: OcrResourceRefKind }
  readonly actorId?: number
  readonly action?: OcrPermissionAction
  readonly result?: OcrPermissionDecisionResult
  readonly reasonCode?: OcrPermissionReasonCode
  readonly from?: string
  readonly to?: string
  readonly page: number
  readonly perPage: number
}

// ─── 决策预览 ────────────────────────────────────────────────────────────────

export interface OcrDecisionPreview {
  readonly action: OcrPermissionAction
  readonly result: OcrPermissionDecisionResult
  readonly requiresConfirmation: boolean
  readonly outputMode: OcrPermissionOutputMode
  readonly reasonCodes: readonly OcrPermissionReasonCode[]
  readonly decisionHash: string
}

// ─── 分页元信息 ──────────────────────────────────────────────────────────────

export interface OcrPaginationMeta {
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly totalPages: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// 类型守卫
// ═══════════════════════════════════════════════════════════════════════════════

export function isOcrPermissionAction(value: unknown): value is OcrPermissionAction {
  return typeof value === 'string' && (OCR_PERMISSION_ACTIONS as readonly string[]).includes(value)
}

export function isOcrPermissionDecisionResult(
  value: unknown,
): value is OcrPermissionDecisionResult {
  return (
    typeof value === 'string' &&
    (OCR_PERMISSION_DECISION_RESULTS as readonly string[]).includes(value)
  )
}

export function isOcrPermissionOutputMode(value: unknown): value is OcrPermissionOutputMode {
  return (
    typeof value === 'string' && (OCR_PERMISSION_OUTPUT_MODES as readonly string[]).includes(value)
  )
}

export function isOcrPermissionReasonCode(value: unknown): value is OcrPermissionReasonCode {
  return (
    typeof value === 'string' && (OCR_PERMISSION_REASON_CODES as readonly string[]).includes(value)
  )
}

export function isOcrPermissionAuditAction(value: unknown): value is OcrPermissionAuditAction {
  return (
    typeof value === 'string' && (OCR_PERMISSION_AUDIT_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrPermissionAuditEvent(value: unknown): value is OcrPermissionAuditEvent {
  return (
    typeof value === 'string' && (OCR_PERMISSION_AUDIT_EVENTS as readonly string[]).includes(value)
  )
}

export function isOcrLifecycleState(value: unknown): value is OcrLifecycleState {
  return typeof value === 'string' && (OCR_LIFECYCLE_STATES as readonly string[]).includes(value)
}

export function isOcrRetentionState(value: unknown): value is OcrRetentionState {
  return typeof value === 'string' && (OCR_RETENTION_STATES as readonly string[]).includes(value)
}

export function isOcrStaleStatus(value: unknown): value is OcrStaleStatus {
  return typeof value === 'string' && (OCR_STALE_STATUSES as readonly string[]).includes(value)
}

export function isOcrGrantedSource(value: unknown): value is OcrGrantedSource {
  return typeof value === 'string' && (OCR_GRANTED_SOURCES as readonly string[]).includes(value)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 动作映射（spec 2.2：确定性映射到后端权限 / UI 允许动作 / 审计动作 / 读写分类）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 每个动作 → { permission, displayAction, auditAction, isMutation }
 * - permission：后端 RBAC 所需权限（与现有 OCR 权限对齐）。
 * - displayAction：UI 允许动作键（低敏感，用于状态面板）。
 * - auditAction：低敏感审计动作键。
 * - isMutation：该动作是否写类（需确认/幂等）。
 *
 * 已审批动作（review_confirm / supersede / export_execute / index_execute /
 * entity_link_run / structured_extraction_run / copy_export_execution）：
 * 均为写类且需目标能力自身 preview/确认契约 —— 本映射不自动 apply。
 */
export const OCR_ACTION_MAPPING: Readonly<
  Record<
    OcrPermissionAction,
    {
      readonly permission: string
      readonly displayAction: string
      readonly auditAction: OcrPermissionAuditAction
      readonly isMutation: boolean
    }
  >
> = {
  metadata_read: {
    permission: 'ocr_document:view',
    displayAction: 'view_metadata',
    auditAction: 'status_read',
    isMutation: false,
  },
  candidate_text_read: {
    permission: 'ocr_document:view',
    displayAction: 'view_candidate',
    auditAction: 'sensitive_read',
    isMutation: false,
  },
  accepted_text_read: {
    permission: 'ocr:review',
    displayAction: 'view_accepted',
    auditAction: 'sensitive_read',
    isMutation: false,
  },
  provider_run: {
    permission: 'ocr_provider_observability:view',
    displayAction: 'run_provider',
    auditAction: 'provider_run',
    isMutation: true,
  },
  review_preview: {
    permission: 'ocr:review',
    displayAction: 'preview_confirmation',
    auditAction: 'review_preview',
    isMutation: false,
  },
  review_confirm: {
    permission: 'ocr:confirm',
    displayAction: 'confirm',
    auditAction: 'review_confirm',
    isMutation: true,
  },
  supersede: {
    permission: 'ocr:confirm',
    displayAction: 'supersede',
    auditAction: 'supersede',
    isMutation: true,
  },
  retention_hold: {
    permission: 'ocr_retention:hold',
    displayAction: 'retention_hold',
    auditAction: 'retention_hold',
    isMutation: true,
  },
  retention_cleanup_preview: {
    permission: 'ocr_retention:cleanup',
    displayAction: 'cleanup_preview',
    auditAction: 'cleanup_preview',
    isMutation: false,
  },
  search_indexing_preview: {
    permission: 'ocr_search_index:view',
    displayAction: 'index_preview',
    auditAction: 'index_preview',
    isMutation: false,
  },
  search_indexing_execution: {
    permission: 'ocr_search_index:manage',
    displayAction: 'index_execute',
    auditAction: 'index_execute',
    isMutation: true,
  },
  structured_extraction_run: {
    permission: 'ocr_structured_extraction:run',
    displayAction: 'structured_run',
    auditAction: 'structured_run',
    isMutation: true,
  },
  entity_linking_run: {
    permission: 'ocr_entity_link:manage',
    displayAction: 'entity_link_run',
    auditAction: 'entity_link_run',
    isMutation: true,
  },
  copy_export_preview: {
    permission: 'ocr_privacy:copy',
    displayAction: 'copy_preview',
    auditAction: 'export_preview',
    isMutation: false,
  },
  copy_export_execution: {
    permission: 'ocr_privacy:export',
    displayAction: 'export_execute',
    auditAction: 'export_execute',
    isMutation: true,
  },
  optional_ai_handoff: {
    permission: 'ocr_privacy:export',
    displayAction: 'ai_handoff',
    auditAction: 'ai_handoff_block',
    isMutation: true,
  },
  explain_request: {
    permission: 'ocr_entity_link:explain',
    displayAction: 'explain',
    auditAction: 'explain_request',
    isMutation: false,
  },
  permission_status_read: {
    permission: 'ocr_permission_audit:view_status',
    displayAction: 'view_status',
    auditAction: 'status_read',
    isMutation: false,
  },
  ocr_audit_read: {
    permission: 'ocr_permission_audit:audit_read',
    displayAction: 'view_audit',
    auditAction: 'status_read',
    isMutation: false,
  },
}

export interface OcrActionMapping {
  readonly action: OcrPermissionAction
  readonly permission: string
  readonly displayAction: string
  readonly auditAction: OcrPermissionAuditAction
  readonly isMutation: boolean
}

/** 确定性地解析动作映射；未知动作返回 null（调用方须按 VALIDATION_ERROR 处理）。 */
export function resolveActionMapping(action: string): OcrActionMapping | null {
  if (!isOcrPermissionAction(action)) return null
  const m = OCR_ACTION_MAPPING[action]
  return {
    action,
    permission: m.permission,
    displayAction: m.displayAction,
    auditAction: m.auditAction,
    isMutation: m.isMutation,
  }
}

/** 动作是否写类（需目标能力自身 preview/确认/idempotency）。 */
export function isMutationAction(action: OcrPermissionAction): boolean {
  return OCR_ACTION_MAPPING[action].isMutation
}

/** 由快照解析允许动作集合（仅 allow / confirm_required 授予动作；其余一律不授予）。 */
export function resolveAllowedActionsFromSnapshot(
  snapshot: OcrAuthorizationDecisionSnapshot,
): OcrPermissionAction[] {
  if (snapshot.result === 'allow' || snapshot.result === 'confirm_required') {
    return [snapshot.action]
  }
  return []
}

// ═══════════════════════════════════════════════════════════════════════════════
// 确定性哈希（spec 2.6）
// ═══════════════════════════════════════════════════════════════════════════════

/** 简单确定性哈希（FNV-1a + 额外混合），非加密用途。 */
function fnv1aHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash >>>= 0
  }
  return hash
}

/** 32 位整数 → 8 字符十六进制。 */
function toHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

/** 稳定排序并拼接 token 数组。 */
function joinTokens(tokens: readonly string[]): string {
  return [...tokens].sort().join('|')
}

/** 计算授权决策快照的确定性哈希。 */
export function computeDecisionHash(input: {
  action: OcrPermissionAction
  result: OcrPermissionDecisionResult
  requiredPermission: string
  grantedPermissionSource: OcrGrantedSource
  roleVersion: number | null
  organizationId: number
  projectId: number
  sourceRefId: number | null
  artifactRefId: number | null
  sourceHash: string | null
  lifecycleState: OcrLifecycleState | null
  retentionState: OcrRetentionState | null
  holdActive: boolean
  staleStatus: OcrStaleStatus
  privacyHash: string | null
  outputMode: OcrPermissionOutputMode
  reasonCodes: readonly OcrPermissionReasonCode[]
}): string {
  const s = [
    input.action,
    input.result,
    input.requiredPermission,
    input.grantedPermissionSource,
    String(input.roleVersion ?? ''),
    String(input.organizationId),
    String(input.projectId),
    String(input.sourceRefId ?? ''),
    String(input.artifactRefId ?? ''),
    input.sourceHash ?? '',
    input.lifecycleState ?? '',
    input.retentionState ?? '',
    String(input.holdActive),
    input.staleStatus,
    input.privacyHash ?? '',
    input.outputMode,
    joinTokens(input.reasonCodes),
  ].join('|')
  return toHex8(fnv1aHash(s))
}

/** 计算权限状态的确定性哈希（覆盖允许/阻止动作与决策哈希）。 */
export function computeStatusHash(input: {
  organizationId: number
  projectId: number
  sourceRefId: number | null
  allowedActions: readonly string[]
  blockedHashes: readonly string[]
  outputMode: OcrPermissionOutputMode
}): string {
  const s = [
    String(input.organizationId),
    String(input.projectId),
    String(input.sourceRefId ?? ''),
    joinTokens(input.allowedActions),
    joinTokens(input.blockedHashes),
    input.outputMode,
  ].join('|')
  return toHex8(fnv1aHash(s))
}

/** 计算审计摘要的确定性哈希（低敏感字段）。 */
export function computeAuditSummaryHash(input: {
  event: string
  action: string
  result: string
  actorId: number
  organizationId: number
  projectId: number
  sourceRefId: number | null
  artifactRefId: number | null
  sourceHash: string | null
  contentHash: string | null
  createdAt: string
}): string {
  const s = [
    input.event,
    input.action,
    input.result,
    String(input.actorId),
    String(input.organizationId),
    String(input.projectId),
    String(input.sourceRefId ?? ''),
    String(input.artifactRefId ?? ''),
    input.sourceHash ?? '',
    input.contentHash ?? '',
    input.createdAt,
  ].join('|')
  return toHex8(fnv1aHash(s))
}

/** 计算来源引用哈希（低敏感，不含文本）。 */
export function computeSourceRefHash(input: {
  organizationId: number
  projectId: number
  sourceId: number
  sourceHash: string
}): string {
  const s = [
    String(input.organizationId),
    String(input.projectId),
    String(input.sourceId),
    input.sourceHash,
  ].join('|')
  return toHex8(fnv1aHash(s))
}

/** 计算内容哈希（低敏感：仅 refs + 统计，不含完整文本）。 */
export function computeContentHash(input: {
  extractionId: number
  sourceHash: string
  selectedTextHash: string | null
  textLength: number
  pageCount: number
}): string {
  const s = [
    String(input.extractionId),
    input.sourceHash,
    input.selectedTextHash ?? '',
    String(input.textLength),
    String(input.pageCount),
  ].join('|')
  return toHex8(fnv1aHash(s))
}

/** 计算幂等键（同上下文 + 决策哈希 → 稳定）。 */
export function computeIdempotencyKey(input: {
  organizationId: number
  projectId: number
  action: string
  decisionHash: string
  artifactRefId: number | null
}): string {
  const s = [
    String(input.organizationId),
    String(input.projectId),
    input.action,
    input.decisionHash,
    String(input.artifactRefId ?? ''),
  ].join('|')
  return toHex8(fnv1aHash(s))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 脱敏助手（spec 2.7）
// ═══════════════════════════════════════════════════════════════════════════════

/** 低敏感审计元数据构建器：仅保留哈希 / 引用 / 枚举码 / 计数 / 摘要。 */
export function buildOcrPermissionAuditMetadata(input: {
  event: string
  action: string
  result: string
  sourceRefKind: string | null
  sourceHash: string | null
  artifactRefKind: string | null
  artifactRefId: number | null
  contentHash: string | null
  lifecycleState: string | null
  retentionState: string | null
  privacyHash: string | null
  decisionHash: string
  reasonCodes: readonly string[]
  countSummaries?: Readonly<Record<string, number>>
  warningCodes?: readonly string[]
  providerSummary?: { readonly provider: string; readonly model: string } | null
}): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    action: input.action,
    result: input.result,
    sourceRefKind: input.sourceRefKind,
    sourceHash: input.sourceHash,
    artifactRefKind: input.artifactRefKind,
    artifactRefId: input.artifactRefId,
    contentHash: input.contentHash,
    lifecycleState: input.lifecycleState,
    retentionState: input.retentionState,
    privacyHash: input.privacyHash,
    decisionHash: input.decisionHash,
    reasonCodes: input.reasonCodes,
  }
  if (input.countSummaries) metadata.countSummaries = input.countSummaries
  if (input.warningCodes && input.warningCodes.length > 0) {
    metadata.warningCodes = input.warningCodes
  }
  if (input.providerSummary) {
    metadata.provider = input.providerSummary.provider
    metadata.model = input.providerSummary.model
  }
  return metadata
}

/** 审计元数据脱敏检查：确认不含任何被禁止的敏感字段。 */
export function isRedactedMetadata(metadata: unknown): boolean {
  // 精确键名（区分大小写不敏感）：contentHash / sourceHash / decisionHash 等哈希字段是低敏感，必须放行。
  const forbiddenExact = [
    'fulltext',
    'ocrtext',
    'content',
    'prompt',
    'modeloutput',
    'apikey',
    'secret',
    'password',
    'authorization',
    'absolutepath',
    'rawbody',
    'searchsnippet',
    'structuredvalue',
  ]
  // 强 token 前缀（宽松匹配，覆盖 api_key / api-key / bearer 头等变体）。
  const forbiddenTokens = ['api_key', 'api-key', 'secret_', 'password_', 'bearer ']
  const walk = (value: unknown): boolean => {
    if (value === null || value === undefined) return true
    if (typeof value !== 'object') return true
    if (Array.isArray(value)) return value.every(walk)
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase()
      if (forbiddenExact.includes(lowerKey)) return false
      if (forbiddenTokens.some((t) => lowerKey.includes(t))) return false
      if (typeof val === 'string' && val.length > 2000) return false // 超长值视为疑似完整文本
      if (!walk(val)) return false
    }
    return true
  }
  return walk(metadata)
}

/** 构造脱敏后的审计元数据（复用 review-confirmation 的递归脱敏）。 */
export function redactAuditMetadataSafe(value: unknown): unknown {
  return redactAuditMetadata(value)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 决策快照构建（纯函数，供 resolver 组合）
// ═══════════════════════════════════════════════════════════════════════════════

export interface OcrDecisionSnapshotInput {
  readonly action: OcrPermissionAction
  readonly result: OcrPermissionDecisionResult
  readonly requiredPermission: string
  readonly grantedPermissionSource: OcrGrantedSource
  readonly roleVersion: number | null
  readonly actorRef: OcrActorRef
  readonly organizationRef: OcrOrganizationRef
  readonly projectRef: OcrProjectRef
  readonly sourceRef: OcrSourceRef | null
  readonly artifactRef: OcrArtifactRef | null
  readonly sourceHash: string | null
  readonly lifecycleState: OcrLifecycleState | null
  readonly retentionState: OcrRetentionState | null
  readonly holdActive: boolean
  readonly staleStatus: OcrStaleStatus
  readonly privacyRef: string | null
  readonly privacyHash: string | null
  readonly outputMode: OcrPermissionOutputMode
  readonly requiresConfirmation: boolean
  readonly reasonCodes: readonly OcrPermissionReasonCode[]
}

/** 由决策输入构建确定性快照（计算 decisionHash）。 */
export function buildDecisionSnapshot(
  input: OcrDecisionSnapshotInput,
): OcrAuthorizationDecisionSnapshot {
  const decisionHash = computeDecisionHash({
    action: input.action,
    result: input.result,
    requiredPermission: input.requiredPermission,
    grantedPermissionSource: input.grantedPermissionSource,
    roleVersion: input.roleVersion,
    organizationId: input.organizationRef.id,
    projectId: input.projectRef.id,
    sourceRefId: input.sourceRef?.id ?? null,
    artifactRefId: input.artifactRef?.id ?? null,
    sourceHash: input.sourceHash,
    lifecycleState: input.lifecycleState,
    retentionState: input.retentionState,
    holdActive: input.holdActive,
    staleStatus: input.staleStatus,
    privacyHash: input.privacyHash,
    outputMode: input.outputMode,
    reasonCodes: input.reasonCodes,
  })
  return {
    action: input.action,
    result: input.result,
    requiredPermission: input.requiredPermission,
    grantedPermissionSource: input.grantedPermissionSource,
    roleVersion: input.roleVersion,
    actorRef: input.actorRef,
    organizationRef: input.organizationRef,
    projectRef: input.projectRef,
    sourceRef: input.sourceRef,
    artifactRef: input.artifactRef,
    sourceHash: input.sourceHash,
    lifecycleState: input.lifecycleState,
    retentionState: input.retentionState,
    holdActive: input.holdActive,
    staleStatus: input.staleStatus,
    privacyRef: input.privacyRef,
    privacyHash: input.privacyHash,
    outputMode: input.outputMode,
    requiresConfirmation: input.requiresConfirmation,
    reasonCodes: input.reasonCodes,
    decisionHash,
  }
}
