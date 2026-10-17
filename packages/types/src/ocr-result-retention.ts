/**
 * V3 OCR Result Persistence And Retention — 共享契约与确定性纯函数引擎
 *
 * 定义 OCR 结果生命周期治理的枚举/接口/类型守卫/纯函数：
 * 敏感度分类、生命周期状态、保留策略解析、cleanup preview/execute、
 * hold、tombstone、低敏摘要与脱敏。
 *
 * 消费 `ocr-document-upload.ts` 与 `ocr-review-confirmation.ts` 的记录，
 * 不改变上传/审查确认契约。
 *
 * 此文件为 Section 2（Shared Contracts And Fixtures）的主产出物。
 */

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** OCR 结果数据的敏感度分类 */
export const OCR_RETENTION_SENSITIVITY_CATEGORIES = [
  'job_metadata',
  'page_state',
  'candidate_text',
  'candidate_metadata',
  'accepted_extraction_text',
  'accepted_extraction_metadata',
  'provider_summary',
  'audit_metadata',
  'tombstone',
] as const
export type OcrRetentionSensitivityCategory = (typeof OCR_RETENTION_SENSITIVITY_CATEGORIES)[number]

/** OCR 结果记录的生命周期状态 */
export const OCR_RETENTION_LIFECYCLE_STATES = [
  'active',
  'reviewable',
  'accepted',
  'superseded',
  'expired',
  'purge_pending',
  'purged',
  'hold_blocked',
] as const
export type OcrRetentionLifecycleState = (typeof OCR_RETENTION_LIFECYCLE_STATES)[number]

/** 受保留治理的记录种类 */
export const OCR_RETENTION_RECORD_KINDS = [
  'job',
  'page',
  'candidate',
  'accepted_extraction',
] as const
export type OcrRetentionRecordKind = (typeof OCR_RETENTION_RECORD_KINDS)[number]

/** 保留到期后的动作 */
export const OCR_RETENTION_EXPIRY_ACTIONS = ['expire', 'redact', 'purge'] as const
export type OcrRetentionExpiryAction = (typeof OCR_RETENTION_EXPIRY_ACTIONS)[number]

/** cleanup 对单条记录计划/执行的动作 */
export const OCR_RETENTION_CLEANUP_ACTIONS = ['expire', 'redact', 'purge', 'tombstone'] as const
export type OcrRetentionCleanupAction = (typeof OCR_RETENTION_CLEANUP_ACTIONS)[number]

/** 记录被阻止清理的原因 */
export const OCR_RETENTION_BLOCKED_REASONS = [
  'within_retention',
  'hold_active',
  'accepted_dependency',
  'source_fresh',
  'already_terminal',
] as const
export type OcrRetentionBlockedReason = (typeof OCR_RETENTION_BLOCKED_REASONS)[number]

/** hold 的作用域种类 */
export const OCR_RETENTION_HOLD_SCOPE_KINDS = [
  'project',
  'source',
  'job',
  'accepted_extraction',
] as const
export type OcrRetentionHoldScopeKind = (typeof OCR_RETENTION_HOLD_SCOPE_KINDS)[number]

/** hold 状态 */
export const OCR_RETENTION_HOLD_STATUSES = ['active', 'released'] as const
export type OcrRetentionHoldStatus = (typeof OCR_RETENTION_HOLD_STATUSES)[number]

/** cleanup run 状态 */
export const OCR_RETENTION_CLEANUP_RUN_STATUSES = [
  'previewed',
  'completed',
  'failed',
  'stale_blocked',
] as const
export type OcrRetentionCleanupRunStatus = (typeof OCR_RETENTION_CLEANUP_RUN_STATUSES)[number]

/** hold 原因代码（低敏，枚举化避免自由文本泄露） */
export const OCR_RETENTION_HOLD_REASON_CODES = [
  'review_in_progress',
  'dispute_resolution',
  'audit_request',
  'administrative',
  'other',
] as const
export type OcrRetentionHoldReasonCode = (typeof OCR_RETENTION_HOLD_REASON_CODES)[number]

/** 保留治理审计动作（低敏） */
export const OCR_RETENTION_AUDIT_ACTIONS = [
  'OCR_RETENTION_POLICY_READ',
  'OCR_RETENTION_POLICY_UPDATED',
  'OCR_RETENTION_STATUS_READ',
  'OCR_RETENTION_PREVIEW',
  'OCR_RETENTION_CLEANUP_EXECUTED',
  'OCR_RETENTION_CLEANUP_FAILED',
  'OCR_RETENTION_EXPIRED',
  'OCR_RETENTION_PURGED',
  'OCR_RETENTION_TOMBSTONE_CREATED',
  'OCR_RETENTION_HOLD_SET',
  'OCR_RETENTION_HOLD_RELEASED',
  'OCR_RETENTION_STALE_PREVIEW_BLOCKED',
  'OCR_RETENTION_PERMISSION_DENIED',
] as const
export type OcrRetentionAuditAction = (typeof OCR_RETENTION_AUDIT_ACTIONS)[number]

/** 保留 UI 中允许的动作（由后端根据权限派生） */
export const OCR_RETENTION_ALLOWED_ACTIONS = [
  'view_status',
  'update_policy',
  'preview_cleanup',
  'execute_cleanup',
  'set_hold',
  'release_hold',
] as const
export type OcrRetentionAllowedAction = (typeof OCR_RETENTION_ALLOWED_ACTIONS)[number]

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

export function isOcrRetentionSensitivityCategory(
  value: unknown,
): value is OcrRetentionSensitivityCategory {
  return (
    typeof value === 'string' &&
    (OCR_RETENTION_SENSITIVITY_CATEGORIES as readonly string[]).includes(value)
  )
}

export function isOcrRetentionLifecycleState(value: unknown): value is OcrRetentionLifecycleState {
  return (
    typeof value === 'string' &&
    (OCR_RETENTION_LIFECYCLE_STATES as readonly string[]).includes(value)
  )
}

export function isOcrRetentionRecordKind(value: unknown): value is OcrRetentionRecordKind {
  return (
    typeof value === 'string' && (OCR_RETENTION_RECORD_KINDS as readonly string[]).includes(value)
  )
}

export function isOcrRetentionExpiryAction(value: unknown): value is OcrRetentionExpiryAction {
  return (
    typeof value === 'string' && (OCR_RETENTION_EXPIRY_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrRetentionBlockedReason(value: unknown): value is OcrRetentionBlockedReason {
  return (
    typeof value === 'string' &&
    (OCR_RETENTION_BLOCKED_REASONS as readonly string[]).includes(value)
  )
}

export function isOcrRetentionHoldScopeKind(value: unknown): value is OcrRetentionHoldScopeKind {
  return (
    typeof value === 'string' &&
    (OCR_RETENTION_HOLD_SCOPE_KINDS as readonly string[]).includes(value)
  )
}

export function isOcrRetentionHoldReasonCode(value: unknown): value is OcrRetentionHoldReasonCode {
  return (
    typeof value === 'string' &&
    (OCR_RETENTION_HOLD_REASON_CODES as readonly string[]).includes(value)
  )
}

export function isOcrRetentionCleanupRunStatus(
  value: unknown,
): value is OcrRetentionCleanupRunStatus {
  return (
    typeof value === 'string' &&
    (OCR_RETENTION_CLEANUP_RUN_STATUSES as readonly string[]).includes(value)
  )
}

// ─── 保留策略 ──────────────────────────────────────────────────────────────

/** 系统不可变边界（天数） */
export const OCR_RETENTION_SYSTEM_BOUNDS = {
  minDays: 1,
  maxDays: 3650,
} as const
export type OcrRetentionSystemBounds = typeof OCR_RETENTION_SYSTEM_BOUNDS

/** 单分类的保留策略 */
export interface OcrRetentionCategoryPolicy {
  category: OcrRetentionSensitivityCategory
  retentionDays: number
  actionAfterExpiry: OcrRetentionExpiryAction
}

/** 策略来源层级 */
export const OCR_RETENTION_POLICY_SOURCES = ['system', 'organization', 'project'] as const
export type OcrRetentionPolicySource = (typeof OCR_RETENTION_POLICY_SOURCES)[number]

/** 解析后的保留策略（确定性，含哈希） */
export interface OcrRetentionPolicy {
  source: OcrRetentionPolicySource
  organizationId: number
  projectId: number | null
  categories: OcrRetentionCategoryPolicy[]
  bounds: OcrRetentionSystemBounds
  policyHash: string
}

/** 策略持久化行（organization/project override） */
export interface OcrRetentionPolicyDTO {
  policyId: number
  organizationId: number
  projectId: number | null
  categories: OcrRetentionCategoryPolicy[]
  policyHash: string
  updatedBy: number | null
  updatedAt: string | null
  createdAt: string | null
}

/** 策略更新请求（只允许边界内的分类覆盖） */
export interface OcrRetentionPolicyUpdateRequest {
  categories: Array<{
    category: OcrRetentionSensitivityCategory
    retentionDays: number
    actionAfterExpiry: OcrRetentionExpiryAction
  }>
}

/** 系统默认策略（天数）；低敏 tombstone 保留最长 */
export const OCR_RETENTION_SYSTEM_DEFAULT_DAYS: Record<OcrRetentionSensitivityCategory, number> = {
  job_metadata: 90,
  page_state: 30,
  candidate_text: 30,
  candidate_metadata: 90,
  accepted_extraction_text: 365,
  accepted_extraction_metadata: 730,
  provider_summary: 90,
  audit_metadata: 730,
  tombstone: 730,
}

/** 系统默认到期动作 */
export const OCR_RETENTION_SYSTEM_DEFAULT_ACTIONS: Record<
  OcrRetentionSensitivityCategory,
  OcrRetentionExpiryAction
> = {
  job_metadata: 'expire',
  page_state: 'expire',
  candidate_text: 'purge',
  candidate_metadata: 'expire',
  accepted_extraction_text: 'redact',
  accepted_extraction_metadata: 'expire',
  provider_summary: 'redact',
  audit_metadata: 'expire',
  tombstone: 'purge',
}

/** 生成系统默认策略的分类数组（确定性顺序 = 枚举顺序） */
export function buildSystemDefaultCategoryPolicies(): OcrRetentionCategoryPolicy[] {
  return OCR_RETENTION_SENSITIVITY_CATEGORIES.map((category) => ({
    category,
    retentionDays: OCR_RETENTION_SYSTEM_DEFAULT_DAYS[category],
    actionAfterExpiry: OCR_RETENTION_SYSTEM_DEFAULT_ACTIONS[category],
  }))
}

// ─── 纯函数：哈希（与 ocr-review-confirmation 同一 FNV-1a 约定） ──────────

function fnv1aHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash >>>= 0
  }
  return hash
}

function toHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

/** 策略哈希：只取决于组织/项目作用域与分类配置，不含时间戳与操作人 */
export function computeRetentionPolicyHash(params: {
  organizationId: number
  projectId: number | null
  categories: OcrRetentionCategoryPolicy[]
}): string {
  const sorted = [...params.categories].sort((a, b) => a.category.localeCompare(b.category))
  const body = sorted
    .map((c) => `${c.category}:${c.retentionDays}:${c.actionAfterExpiry}`)
    .join('|')
  return toHex8(fnv1aHash(`${params.organizationId}|${params.projectId ?? 'org'}|${body}`))
}

/** cleanup preview 哈希：作用域 + 策略哈希 + 记录指纹 + now 时间桶 */
export function computeCleanupPreviewHash(params: {
  organizationId: number
  projectId: number
  policyHash: string
  recordFingerprints: string[]
  nowIso: string
}): string {
  const fps = [...params.recordFingerprints].sort().join('|')
  return toHex8(
    fnv1aHash(
      `${params.organizationId}|${params.projectId}|${params.policyHash}|${fps}|${params.nowIso}`,
    ),
  )
}

/** 单条记录的确定性指纹（不含敏感文本，仅 id+kind+lifecycle+hashes） */
export function computeRecordFingerprint(params: {
  recordKind: OcrRetentionRecordKind
  recordId: number
  lifecycleState: OcrRetentionLifecycleState
  sourceHash: string | null
  contentHash: string | null
}): string {
  return toHex8(
    fnv1aHash(
      `${params.recordKind}|${params.recordId}|${params.lifecycleState}|${params.sourceHash ?? ''}|${params.contentHash ?? ''}`,
    ),
  )
}

/** tombstone 哈希：记录身份 + 清理原因 + 策略快照哈希 */
export function computeTombstoneHash(params: {
  recordKind: OcrRetentionRecordKind
  recordId: number
  cleanupReason: string
  policyHash: string
  purgedAtIso: string
}): string {
  return toHex8(
    fnv1aHash(
      `${params.recordKind}|${params.recordId}|${params.cleanupReason}|${params.policyHash}|${params.purgedAtIso}`,
    ),
  )
}

/** hold 作用域哈希：低敏标识 hold 覆盖范围 */
export function computeHoldScopeHash(params: {
  organizationId: number
  projectId: number
  scopeKind: OcrRetentionHoldScopeKind
  scopeRef: string
}): string {
  return toHex8(
    fnv1aHash(
      `${params.organizationId}|${params.projectId}|${params.scopeKind}|${params.scopeRef}`,
    ),
  )
}

// ─── 纯函数：生命周期状态机 ────────────────────────────────────────────────

/**
 * 合法生命周期迁移表。
 * hold_blocked 可回到 hold 前的任意非终态；purged 为终态。
 */
export const OCR_RETENTION_LIFECYCLE_TRANSITIONS: Record<
  OcrRetentionLifecycleState,
  OcrRetentionLifecycleState[]
> = {
  active: ['reviewable', 'accepted', 'expired', 'purge_pending', 'hold_blocked'],
  reviewable: ['accepted', 'expired', 'purge_pending', 'hold_blocked'],
  accepted: ['superseded', 'expired', 'purge_pending', 'hold_blocked'],
  superseded: ['expired', 'purge_pending', 'hold_blocked'],
  expired: ['purge_pending', 'purged', 'hold_blocked'],
  purge_pending: ['purged', 'hold_blocked'],
  purged: [],
  hold_blocked: ['active', 'reviewable', 'accepted', 'superseded', 'expired', 'purge_pending'],
}

export function isValidOcrRetentionLifecycleTransition(
  from: OcrRetentionLifecycleState,
  to: OcrRetentionLifecycleState,
): boolean {
  return OCR_RETENTION_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false
}

// ─── 纯函数：策略解析 ──────────────────────────────────────────────────────

/** 找出越界/非法的分类配置；返回空数组表示全部合法 */
export function findInvalidCategoryPolicies(
  categories: OcrRetentionCategoryPolicy[],
  bounds: OcrRetentionSystemBounds = OCR_RETENTION_SYSTEM_BOUNDS,
): Array<{ category: string; reason: 'out_of_bounds' | 'unknown_category' | 'duplicate' }> {
  const invalid: Array<{
    category: string
    reason: 'out_of_bounds' | 'unknown_category' | 'duplicate'
  }> = []
  const seen = new Set<string>()
  for (const c of categories) {
    if (!isOcrRetentionSensitivityCategory(c.category)) {
      invalid.push({ category: String(c.category), reason: 'unknown_category' })
      continue
    }
    if (seen.has(c.category)) {
      invalid.push({ category: c.category, reason: 'duplicate' })
      continue
    }
    seen.add(c.category)
    if (
      !Number.isInteger(c.retentionDays) ||
      c.retentionDays < bounds.minDays ||
      c.retentionDays > bounds.maxDays
    ) {
      invalid.push({ category: c.category, reason: 'out_of_bounds' })
    }
  }
  return invalid
}

/**
 * 合并 override 到基础策略：override 只覆盖其显式给出的分类，
 * 其余分类沿用基础策略；系统边界不可变。
 * 调用方必须先通过 findInvalidCategoryPolicies 校验 override。
 */
export function mergeRetentionPolicyOverride(
  base: OcrRetentionCategoryPolicy[],
  override: Array<{
    category: OcrRetentionSensitivityCategory
    retentionDays: number
    actionAfterExpiry: OcrRetentionExpiryAction
  }>,
): OcrRetentionCategoryPolicy[] {
  const overrideMap = new Map(override.map((o) => [o.category, o]))
  return OCR_RETENTION_SENSITIVITY_CATEGORIES.map((category) => {
    const o = overrideMap.get(category)
    if (o) {
      return {
        category,
        retentionDays: o.retentionDays,
        actionAfterExpiry: o.actionAfterExpiry,
      }
    }
    const b = base.find((x) => x.category === category)
    return (
      b ?? {
        category,
        retentionDays: OCR_RETENTION_SYSTEM_DEFAULT_DAYS[category],
        actionAfterExpiry: OCR_RETENTION_SYSTEM_DEFAULT_ACTIONS[category],
      }
    )
  })
}

/** 解析系统默认策略（无 override 时的兜底） */
export function resolveSystemDefaultRetentionPolicy(params: {
  organizationId: number
  projectId?: number | null
}): OcrRetentionPolicy {
  const categories = buildSystemDefaultCategoryPolicies()
  return {
    source: 'system',
    organizationId: params.organizationId,
    projectId: params.projectId ?? null,
    categories,
    bounds: OCR_RETENTION_SYSTEM_BOUNDS,
    policyHash: computeRetentionPolicyHash({
      organizationId: params.organizationId,
      projectId: params.projectId ?? null,
      categories,
    }),
  }
}

/** 按分类取保留天数 */
export function retentionDaysForCategory(
  policy: OcrRetentionPolicy,
  category: OcrRetentionSensitivityCategory,
): number {
  const found = policy.categories.find((c) => c.category === category)
  return found?.retentionDays ?? OCR_RETENTION_SYSTEM_DEFAULT_DAYS[category]
}

/** 计算保留截止时间（ISO 字符串；baseIso + retentionDays） */
export function computeRetentionDeadlineIso(baseIso: string, retentionDays: number): string {
  const base = new Date(baseIso)
  const ms = base.getTime() + retentionDays * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

/** 记录是否已到保留截止时间 */
export function isRetentionDeadlineReached(params: {
  baseIso: string
  retentionDays: number
  nowIso: string
}): boolean {
  return (
    new Date(params.nowIso).getTime() >=
    new Date(computeRetentionDeadlineIso(params.baseIso, params.retentionDays)).getTime()
  )
}

// ─── 纯函数：脱敏 ──────────────────────────────────────────────────────────

const RETENTION_REDACT_KEY_PATTERNS: RegExp[] = [
  /api[-_]?key/i,
  /authorization/i,
  /token/i,
  /secret/i,
  /password/i,
  /prompt/i,
  /dataurl/i,
  /base64/i,
  /raw[-_]?body/i,
  /raw.*body/i,
  /provider[-_]?(body|payload|response)/i,
  /absolute[-_]?path/i,
  /extracted[-_]?text/i,
  /accepted[-_]?text/i,
  /selected[-_]?text/i,
  /full[-_]?text/i,
  /file[-_]?content/i,
  /storage[-_]?path/i,
]

/** 绝对路径探测（POSIX / Windows 盘符 / UNC） */
export function looksLikeAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/**
 * 递归脱敏：命中敏感键名替换为 `[REDACTED]`；
 * 字符串值若形似绝对路径也替换。用于公共摘要/tombstone/审计载荷。
 */
export function redactRetentionSensitiveFields(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return looksLikeAbsolutePath(value) ? '[REDACTED]' : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(redactRetentionSensitiveFields)
  }
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (RETENTION_REDACT_KEY_PATTERNS.some((p) => p.test(key))) {
      result[key] = '[REDACTED]'
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactRetentionSensitiveFields(val)
    } else if (typeof val === 'string' && looksLikeAbsolutePath(val)) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = val
    }
  }
  return result
}

/**
 * 断言式检查：递归检查对象键名是否含敏感内容标记。
 * 以 `Hash` 结尾的键是低敏指纹（如 selectedTextHash），不计为敏感。
 */
export function containsSensitiveMarkers(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some(containsSensitiveMarkers)
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!/hash$/i.test(key) && RETENTION_REDACT_KEY_PATTERNS.some((p) => p.test(key))) {
      return true
    }
    if (typeof val === 'object' && val !== null && containsSensitiveMarkers(val)) {
      return true
    }
  }
  return false
}

// ─── 共享 DTO：状态/记录摘要 ───────────────────────────────────────────────

/** 单条受治理记录的低敏摘要 */
export interface OcrRetentionRecordSummary {
  recordKind: OcrRetentionRecordKind
  recordId: number
  lifecycleState: OcrRetentionLifecycleState
  sensitivityCategory: OcrRetentionSensitivityCategory
  sourceKind: string | null
  sourceHash: string | null
  contentHash: string | null
  retentionDeadline: string | null
  blockedReason: OcrRetentionBlockedReason | null
  holdActive: boolean
  /** 候选文本是否仍可读取（purged/redacted 后为 false） */
  textAvailable: boolean
}

/** 项目级保留状态响应 */
export interface OcrRetentionStatusResponse {
  organizationId: number
  projectId: number
  policy: OcrRetentionPolicy
  counts: Record<OcrRetentionLifecycleState, number>
  countsByKind: Record<OcrRetentionRecordKind, number>
  expiringSoon: number
  holdActiveCount: number
  allowedActions: OcrRetentionAllowedAction[]
}

/** accepted extraction 的保留摘要（低敏） */
export interface OcrAcceptedExtractionRetentionSummary {
  extractionId: number
  lifecycleState: OcrRetentionLifecycleState
  status: 'current' | 'superseded'
  sourceHash: string
  candidateHash: string
  selectedTextHash: string
  reviewerId: number | null
  pageRefs: number[]
  retentionDeadline: string | null
  holdActive: boolean
  textAvailable: boolean
  tombstoneId: number | null
  confirmedAt: string | null
  supersededAt: string | null
}

// ─── 共享 DTO：cleanup preview / execute ───────────────────────────────────

/** preview 中单条记录的计划动作 */
export interface OcrCleanupPreviewItem {
  recordKind: OcrRetentionRecordKind
  recordId: number
  lifecycleState: OcrRetentionLifecycleState
  plannedAction: OcrRetentionCleanupAction | null
  blockedReason: OcrRetentionBlockedReason | null
  contentHash: string | null
  sourceHash: string | null
}

/** cleanup preview 请求 */
export interface OcrCleanupPreviewRequest {
  recordKinds?: OcrRetentionRecordKind[]
  sourceHash?: string | null
  jobId?: number | null
  limit?: number
}

/** cleanup preview 响应 */
export interface OcrCleanupPreviewResponse {
  previewHash: string
  policyHash: string
  generatedAt: string
  eligible: OcrCleanupPreviewItem[]
  blocked: OcrCleanupPreviewItem[]
  plannedTombstones: number
  policyEvidence: {
    source: OcrRetentionPolicySource
    bounds: OcrRetentionSystemBounds
  }
  truncated: boolean
  requiresExplicitConfirmation: true
}

/** cleanup 执行请求 */
export interface OcrCleanupExecuteRequest {
  previewHash: string
  runKey: string
  confirm: true
}

/** cleanup 执行结果 */
export interface OcrCleanupResultDTO {
  runId: number
  runKey: string
  status: OcrRetentionCleanupRunStatus
  previewHash: string
  policyHash: string
  expiredCount: number
  redactedCount: number
  purgedCount: number
  tombstoneCount: number
  blockedCount: number
  replayed: boolean
  startedAt: string
  completedAt: string | null
  failureReason: string | null
}

// ─── 共享 DTO：hold ────────────────────────────────────────────────────────

/** hold 记录（低敏） */
export interface OcrRetentionHoldDTO {
  holdId: number
  organizationId: number
  projectId: number
  scopeKind: OcrRetentionHoldScopeKind
  scopeHash: string
  reasonCode: OcrRetentionHoldReasonCode
  note: string | null
  status: OcrRetentionHoldStatus
  setBy: number
  setAt: string
  releasedBy: number | null
  releasedAt: string | null
}

/** hold 设置请求 */
export interface OcrRetentionHoldSetRequest {
  scopeKind: OcrRetentionHoldScopeKind
  scopeRef: string
  reasonCode: OcrRetentionHoldReasonCode
  note?: string | null
}

/** hold 释放请求 */
export interface OcrRetentionHoldReleaseRequest {
  holdId: number
}

/** hold note 的最大长度（低敏有界） */
export const OCR_RETENTION_HOLD_NOTE_MAX_LENGTH = 200

/** hold note 校验：有界且不含绝对路径 */
export function isValidHoldNote(note: string | null | undefined): boolean {
  if (note === null || note === undefined) return true
  if (note.length > OCR_RETENTION_HOLD_NOTE_MAX_LENGTH) return false
  if (looksLikeAbsolutePath(note)) return false
  return true
}

// ─── 共享 DTO：tombstone ───────────────────────────────────────────────────

/** 低敏 tombstone（清理后的可追溯痕迹） */
export interface OcrRetentionTombstoneDTO {
  tombstoneId: number
  organizationId: number
  projectId: number
  recordKind: OcrRetentionRecordKind
  recordId: number
  sourceKind: string | null
  sourceHash: string | null
  contentHash: string | null
  lifecycleAction: OcrRetentionCleanupAction
  cleanupReason: string
  policyHash: string
  tombstoneHash: string
  cleanupRunId: number | null
  createdAt: string
}

/** 构建低敏 tombstone 负载（自动脱敏，绝不包含完整文本） */
export function buildLowSensitiveTombstonePayload(params: {
  organizationId: number
  projectId: number
  recordKind: OcrRetentionRecordKind
  recordId: number
  sourceKind: string | null
  sourceHash: string | null
  contentHash: string | null
  lifecycleAction: OcrRetentionCleanupAction
  cleanupReason: string
  policyHash: string
  purgedAtIso: string
}): Omit<OcrRetentionTombstoneDTO, 'tombstoneId' | 'cleanupRunId' | 'createdAt'> & {
  tombstoneHash: string
} {
  const tombstoneHash = computeTombstoneHash({
    recordKind: params.recordKind,
    recordId: params.recordId,
    cleanupReason: params.cleanupReason,
    policyHash: params.policyHash,
    purgedAtIso: params.purgedAtIso,
  })
  const payload = {
    organizationId: params.organizationId,
    projectId: params.projectId,
    recordKind: params.recordKind,
    recordId: params.recordId,
    sourceKind: params.sourceKind,
    sourceHash: params.sourceHash,
    contentHash: params.contentHash,
    lifecycleAction: params.lifecycleAction,
    cleanupReason: params.cleanupReason,
    policyHash: params.policyHash,
    tombstoneHash,
  }
  return redactRetentionSensitiveFields(payload) as typeof payload
}

// ─── 纯函数：allowed actions 解析 ──────────────────────────────────────────

/** 根据权限解析保留治理允许动作 */
export function resolveOcrRetentionAllowedActions(params: {
  canView: boolean
  canManage: boolean
  canHold: boolean
}): OcrRetentionAllowedAction[] {
  const actions: OcrRetentionAllowedAction[] = []
  if (params.canView) actions.push('view_status')
  if (params.canManage) {
    actions.push('update_policy')
    actions.push('preview_cleanup')
    actions.push('execute_cleanup')
  }
  if (params.canHold) {
    actions.push('set_hold')
    actions.push('release_hold')
  }
  return actions
}

// ─── 纯函数：低敏审计元数据 ────────────────────────────────────────────────

/** 构建低敏审计元数据（只保留哈希/计数/引用，自动脱敏） */
export function buildOcrRetentionAuditMetadata(params: {
  actorId: number
  organizationId: number
  projectId: number
  action: OcrRetentionAuditAction
  policyHash?: string | null
  previewHash?: string | null
  runId?: number | null
  holdId?: number | null
  tombstoneId?: number | null
  recordKind?: OcrRetentionRecordKind | null
  recordId?: number | null
  contentHash?: string | null
  sourceHash?: string | null
  counts?: Record<string, number> | null
  reasonCode?: string | null
  denialReason?: string | null
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    actor: params.actorId,
    org: params.organizationId,
    project: params.projectId,
    action: params.action,
  }
  if (params.policyHash) meta.policyHash = params.policyHash
  if (params.previewHash) meta.previewHash = params.previewHash
  if (params.runId !== undefined && params.runId !== null) meta.runId = params.runId
  if (params.holdId !== undefined && params.holdId !== null) meta.holdId = params.holdId
  if (params.tombstoneId !== undefined && params.tombstoneId !== null)
    meta.tombstoneId = params.tombstoneId
  if (params.recordKind) meta.recordKind = params.recordKind
  if (params.recordId !== undefined && params.recordId !== null) meta.recordId = params.recordId
  if (params.contentHash) meta.contentHash = params.contentHash
  if (params.sourceHash) meta.sourceHash = params.sourceHash
  if (params.counts) meta.counts = params.counts
  if (params.reasonCode) meta.reasonCode = params.reasonCode
  if (params.denialReason) meta.denialReason = params.denialReason
  return redactRetentionSensitiveFields(meta) as Record<string, unknown>
}
