/**
 * v3-ocr-batch-and-queue-processing — OCR 批量入队与本机 durable queue 共享契约。
 *
 * 本模块提供：
 * - batch/queue item 状态、work kind、control action、warning code、failure category 枚举
 * - 共享 DTO（batch create/list/detail、batch source summary、queue item summary、queue project summary、control requests、allowed actions）
 * - 纯函数（batch input signature、queue idempotency key、source sorting、status aggregation、progress counters）
 * - 脱敏函数（去除 OCR 文本、provider payloads、prompt hints、API keys、Authorization headers、source bytes、绝对路径、隐藏源名称）
 * - 确定性重试/退避辅助合约
 * - 允许动作辅助合约
 *
 * 红线：不存储 prompt/output/provider body/API key/Authorization header/full extracted text/绝对路径/隐藏源名称。
 * 默认测试 = fixtures + fake provider + fake clock，无真实 OCR provider/model 调用，无网络调用。
 */

// ---------------------------------------------------------------------------
// 枚举：batch 状态 / queue item 状态 / work kind / control action / warning code / failure category
// ---------------------------------------------------------------------------

export const OCR_BATCH_STATUSES = [
  'drafting',
  'queued',
  'processing',
  'partial',
  'completed',
  'failed',
  'cancelled',
  'paused',
] as const
export type OcrBatchStatus = (typeof OCR_BATCH_STATUSES)[number]

export const OCR_BATCH_AGGREGATE_STATUSES = [
  'none',
  'queued',
  'processing',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'budget_blocked',
  'rate_limited',
  'stale_blocked',
] as const
export type OcrBatchAggregateStatus = (typeof OCR_BATCH_AGGREGATE_STATUSES)[number]

export const OCR_QUEUE_ITEM_STATUSES = [
  'queued',
  'claimed',
  'processing',
  'succeeded',
  'failed',
  'retryable',
  'budget_blocked',
  'rate_limited',
  'stale_blocked',
  'cancelled',
  'terminal_failure',
  /** 因保留 hold 状态被阻塞 */
  'retention_blocked',
] as const
export type OcrQueueItemStatus = (typeof OCR_QUEUE_ITEM_STATUSES)[number]

export const OCR_QUEUE_WORK_KINDS = ['job', 'page'] as const
export type OcrQueueWorkKind = (typeof OCR_QUEUE_WORK_KINDS)[number]

export const OCR_BATCH_CONTROL_ACTIONS = ['retry', 'cancel', 'resume'] as const
export type OcrBatchControlAction = (typeof OCR_BATCH_CONTROL_ACTIONS)[number]

export const OCR_BATCH_WARNING_CODES = [
  'BATCH_SIZE_CAPPED',
  'SOURCE_STALE',
  'SOURCE_RETENTION_HOLD',
  'SOURCE_DELETED',
  'MODEL_UNAVAILABLE',
  'BUDGET_BLOCK',
  'RATE_LIMIT_WAIT',
  'PARTIAL_FAILURE',
  'CANCELLED_PENDING',
  'DISPATCHER_UNAVAILABLE',
  'DUPLICATE_SOURCE',
  'EXHAUSTED_ATTEMPTS',
  'TERMINAL_FAILURE',
  'IDEMPOTENCY_CONFLICT',
  'QUEUE_UNAVAILABLE',
] as const
export type OcrBatchWarningCode = (typeof OCR_BATCH_WARNING_CODES)[number]

export const OCR_QUEUE_FAILURE_CATEGORIES = [
  'none',
  'auth',
  'timeout',
  'rate_limit',
  'unavailable',
  'malformed_response',
  'capability_mismatch',
  'budget_blocked',
  'rate_limited',
  'stale_source',
  'retention_hold',
  'source_deleted',
  'cancelled',
  'exhausted_attempts',
  'unknown',
] as const
export type OcrQueueFailureCategory = (typeof OCR_QUEUE_FAILURE_CATEGORIES)[number]

export const OCR_BATCH_PERMISSION_ACTIONS = [
  'ocr_batch:view',
  'ocr_batch:create',
  'ocr_batch:retry',
  'ocr_batch:cancel',
  'ocr_batch:resume',
  'ocr_queue:inspect',
] as const
export type OcrBatchPermissionAction = (typeof OCR_BATCH_PERMISSION_ACTIONS)[number]

export const OCR_BATCH_AUDIT_ACTIONS = [
  'OCR_BATCH_CREATED',
  'OCR_BATCH_ENQUEUE',
  'OCR_QUEUE_ITEM_DISPATCH_CLAIM',
  'OCR_QUEUE_ITEM_DISPATCH_COMPLETE',
  'OCR_QUEUE_ITEM_RETRY',
  'OCR_BATCH_CANCEL',
  'OCR_BATCH_RESUME',
  'OCR_QUEUE_ITEM_STALE_BLOCK',
  'OCR_QUEUE_ITEM_TERMINAL_FAILURE',
  'OCR_QUEUE_READ',
  'OCR_QUEUE_PERMISSION_DENIED',
] as const
export type OcrBatchAuditAction = (typeof OCR_BATCH_AUDIT_ACTIONS)[number]

export const OCR_BATCH_ALLOWED_ACTIONS = [
  ...OCR_BATCH_CONTROL_ACTIONS,
  'view',
  'create',
  'inspect_queue',
] as const
export type OcrBatchAllowedAction = (typeof OCR_BATCH_ALLOWED_ACTIONS)[number]

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isOcrBatchStatus(value: unknown): value is OcrBatchStatus {
  return OCR_BATCH_STATUSES.includes(value as OcrBatchStatus)
}

export function isOcrQueueItemStatus(value: unknown): value is OcrQueueItemStatus {
  return OCR_QUEUE_ITEM_STATUSES.includes(value as OcrQueueItemStatus)
}

export function isOcrQueueWorkKind(value: unknown): value is OcrQueueWorkKind {
  return OCR_QUEUE_WORK_KINDS.includes(value as OcrQueueWorkKind)
}

export function isOcrBatchControlAction(value: unknown): value is OcrBatchControlAction {
  return OCR_BATCH_CONTROL_ACTIONS.includes(value as OcrBatchControlAction)
}

export function isOcrBatchWarningCode(value: unknown): value is OcrBatchWarningCode {
  return OCR_BATCH_WARNING_CODES.includes(value as OcrBatchWarningCode)
}

export function isOcrQueueFailureCategory(value: unknown): value is OcrQueueFailureCategory {
  return OCR_QUEUE_FAILURE_CATEGORIES.includes(value as OcrQueueFailureCategory)
}

export function isOcrBatchPermissionAction(value: unknown): value is OcrBatchPermissionAction {
  return OCR_BATCH_PERMISSION_ACTIONS.includes(value as OcrBatchPermissionAction)
}

export function isOcrBatchAuditAction(value: unknown): value is OcrBatchAuditAction {
  return OCR_BATCH_AUDIT_ACTIONS.includes(value as OcrBatchAuditAction)
}

// ---------------------------------------------------------------------------
// DTO：batch create/list/detail、source summary、queue item summary、queue project summary
// ---------------------------------------------------------------------------

export interface OcrBatchSourceInput {
  sourceAttachmentId: number | string
  sourceKind?: 'upload' | 'attachment'
}

export interface OcrBatchCreateRequest {
  sources: OcrBatchSourceInput[]
  connectionId?: number | string | null
  modelId?: number | string | null
  promptHint?: string | null
  pageLimit?: number | null
  idempotencyKey?: string | null
}

export interface OcrBatchSourceSummary {
  sourceIndex: number
  sourceAttachmentId: number | string
  sourceFileName: string | null
  sourceMimeType: string | null
  sourceHash: string
  /** 关联的 OCR document job id（可能为 null 如果尚未创建） */
  ocrJobId: number | string | null
  status: string
  warningCodes: OcrBatchWarningCode[]
}

export interface OcrBatchSummary {
  id: number | string
  organizationId: number
  projectId: number
  createdBy: number
  status: OcrBatchStatus
  aggregateStatus: OcrBatchAggregateStatus
  sourceCount: number
  completedCount: number
  failedCount: number
  cancelledCount: number
  queuedCount: number
  processingCount: number
  idempotencyKeyHash: string | null
  inputSignature: string | null
  provider: string | null
  model: string | null
  warningCodes: OcrBatchWarningCode[]
  costSummary: OcrBatchCostSummary | null
  createdAt: string
  updatedAt: string
}

export interface OcrBatchDetail extends OcrBatchSummary {
  connectionId: number | string | null
  modelId: number | string | null
  promptHint: string | null
  sources: OcrBatchSourceSummary[]
  warnings: OcrBatchWarning[]
  allowedActions: OcrBatchAllowedAction[]
}

export interface OcrQueueItemSummary {
  id: number | string
  organizationId: number
  projectId: number
  batchId: number | string
  jobId: number | string
  pageId: number | string | null
  workKind: OcrQueueWorkKind
  priority: number
  status: OcrQueueItemStatus
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: string | null
  retryAfter: string | null
  sourceHash: string
  failureCategory: OcrQueueFailureCategory
  warningCodes: OcrBatchWarningCode[]
  provider: string | null
  model: string | null
  /** 脱敏后的源引用（不含完整路径/hidden name） */
  sourceRef: string | null
  createdAt: string
  updatedAt: string
}

export interface OcrQueueProjectSummary {
  projectId: number
  total: number
  queued: number
  processing: number
  succeeded: number
  failed: number
  cancelled: number
  budgetBlocked: number
  rateLimited: number
  staleBlocked: number
  oldestQueuedAt: string | null
}

export interface OcrBatchControlRequest {
  /** 幂等控制键，可用于同一操作的安全重放 */
  controlKey?: string | null
}

export interface OcrBatchRetryRequest extends OcrBatchControlRequest {
  /** 可选源筛选——只重试特定源的队列项 */
  sourceAttachmentIds?: (number | string)[] | null
  /** 可选模型覆盖 */
  connectionId?: number | string | null
  modelId?: number | string | null
}

export interface OcrBatchCancelRequest extends OcrBatchControlRequest {
  /** 取消原因（低敏）*/
  reason?: string | null
}

export interface OcrBatchResumeRequest extends OcrBatchControlRequest {
  /** 可选模型覆盖 */
  connectionId?: number | string | null
  modelId?: number | string | null
}

export interface OcrBatchListFilters {
  page?: number
  perPage?: number
  status?: OcrBatchStatus | null
  sort?: string | null
}

export interface OcrQueueListFilters {
  page?: number
  perPage?: number
  status?: OcrQueueItemStatus | null
  batchId?: number | string | null
  sort?: string | null
}

export interface OcrBatchWarning {
  code: OcrBatchWarningCode
  message: string
  sourceIndex?: number | null
}

export interface OcrBatchCostSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  estimatedCost: number | null
  currency: string | null
}

export const OCR_BATCH_TERMINAL_STATUSES: readonly OcrBatchStatus[] = [
  'completed',
  'failed',
  'cancelled',
]

export const OCR_QUEUE_TERMINAL_STATUSES: readonly OcrQueueItemStatus[] = [
  'succeeded',
  'terminal_failure',
  'cancelled',
]

export const OCR_BATCH_RETRYABLE_STATUSES: readonly OcrBatchStatus[] = [
  'partial',
  'failed',
  'paused',
]

// ---------------------------------------------------------------------------
// 默认队列边界配置
// ---------------------------------------------------------------------------

export const OCR_BATCH_DEFAULT_MAX_SOURCES = 20
export const OCR_BATCH_DEFAULT_MAX_PAGES_PER_BATCH = 200
export const OCR_QUEUE_DEFAULT_CLAIM_LIMIT = 5
export const OCR_QUEUE_DEFAULT_MAX_ATTEMPTS = 3
export const OCR_QUEUE_DEFAULT_STALE_LOCK_MS = 300_000 // 5 min
export const OCR_QUEUE_DEFAULT_RETRY_BASE_DELAY_MS = 10_000 // 10 s
export const OCR_QUEUE_DEFAULT_RETRY_MAX_DELAY_MS = 600_000 // 10 min

// ---------------------------------------------------------------------------
// 纯函数：batch input signature / queue idempotency key / progress aggregation
// ---------------------------------------------------------------------------

/**
 * FNV-1a 64-bit 哈希（低敏摘要用，不可逆，非加密）。
 * 与 ocr-document-upload 中的 ocrDocFnv1aHash 兼容。
 */
export function ocrBatchFnv1aHash(input: string): string {
  let h = BigInt('0xcbf29ce484222325')
  const fnvPrime = BigInt('0x100000001b3')
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i))
    h = (h * fnvPrime) & BigInt('0xffffffffffffffff')
  }
  return h.toString(16).padStart(16, '0')
}

/**
 * 批量输入签名：从 sources + model/options/idempotency key 生成确定性哈希。
 * 包含 source attachment ids（排序后）、modelId、promptHint、pageLimit、idempotencyKey。
 */
export function computeBatchInputSignature(params: {
  sourceAttachmentIds: (number | string)[]
  modelId?: number | string | null
  connectionId?: number | string | null
  promptHint?: string | null
  pageLimit?: number | null
  idempotencyKey?: string | null
}): string {
  const sortedSourceIds = [...params.sourceAttachmentIds]
    .map((id) => String(id))
    .sort()
    .join(',')
  const payload = [
    sortedSourceIds,
    params.connectionId ?? '',
    params.modelId ?? '',
    params.promptHint ?? '',
    params.pageLimit ?? '',
    params.idempotencyKey ?? '',
  ].join(':')
  return ocrBatchFnv1aHash(payload)
}

/**
 * 幂等键归一化：trim + 上限 256 字符。
 */
export function normalizeBatchIdempotencyKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 256)
}

/**
 * 队列项幂等键：包含 organization/project/batch/job/page refs + source hash + model ref + attempt scope。
 */
export function computeQueueIdempotencyKey(params: {
  organizationId: number
  projectId: number
  batchId: number | string
  jobId: number | string
  pageId?: number | string | null
  sourceHash: string
  modelId?: number | string | null
  attemptScope: string
}): string {
  const payload = [
    params.organizationId,
    params.projectId,
    params.batchId,
    params.jobId,
    params.pageId ?? '',
    params.sourceHash,
    params.modelId ?? '',
    params.attemptScope,
  ].join(':')
  return ocrBatchFnv1aHash(payload)
}

/**
 * 按 (attachmentId, sourceIndex) 对 sources 排序。
 */
export function sortBatchSources(sources: OcrBatchSourceInput[]): OcrBatchSourceInput[] {
  return [...sources]
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => {
      const idDiff = Number(a.s.sourceAttachmentId) - Number(b.s.sourceAttachmentId)
      if (idDiff !== 0) return idDiff
      return a.idx - b.idx
    })
    .map(({ s }) => ({ ...s }))
}

/**
 * 去重 sources（按 sourceAttachmentId），保留首次出现，记录警告。
 */
export function deduplicateBatchSources(sources: OcrBatchSourceInput[]): {
  deduplicated: OcrBatchSourceInput[]
  duplicateCount: number
} {
  const seen = new Set<string>()
  const result: OcrBatchSourceInput[] = []
  let duplicateCount = 0
  for (const source of sources) {
    const key = String(source.sourceAttachmentId)
    if (seen.has(key)) {
      duplicateCount++
    } else {
      seen.add(key)
      result.push(source)
    }
  }
  return { deduplicated: result, duplicateCount }
}

/**
 * 从 batch summary 聚合 batch 级别的 progress counters。
 */
export function aggregateBatchProgress(params: {
  queuedCount: number
  processingCount: number
  completedCount: number
  failedCount: number
  cancelledCount: number
}): {
  total: number
  completed: number
  pending: number
} {
  const total =
    params.queuedCount +
    params.processingCount +
    params.completedCount +
    params.failedCount +
    params.cancelledCount
  return {
    total,
    completed: params.completedCount,
    pending: params.queuedCount + params.processingCount,
  }
}

/**
 * 从 queue items 状态聚合 batch 聚合状态。
 */
export function deriveBatchAggregateStatus(
  items: {
    status: OcrQueueItemStatus
  }[],
): OcrBatchAggregateStatus {
  if (items.length === 0) return 'none'
  const statuses = items.map((i) => i.status)
  const hasQueued = statuses.some((s) => s === 'queued')
  const hasClaimed = statuses.some((s) => s === 'claimed')
  const hasProcessing = statuses.some((s) => s === 'processing')
  const hasSucceeded = statuses.some((s) => s === 'succeeded')
  const hasFailed = statuses.some((s) => s === 'failed')
  const hasRetryable = statuses.some((s) => s === 'retryable')
  const hasBudgetBlocked = statuses.some((s) => s === 'budget_blocked')
  const hasRateLimited = statuses.some((s) => s === 'rate_limited')
  const hasStaleBlocked = statuses.some((s) => s === 'stale_blocked')
  const hasCancelled = statuses.some((s) => s === 'cancelled')
  const hasTerminalFailure = statuses.some((s) => s === 'terminal_failure')

  if (hasQueued || hasClaimed || hasProcessing) {
    if (hasSucceeded || hasFailed) return 'partial'
    return 'processing'
  }
  if (hasRateLimited) return 'rate_limited'
  if (hasBudgetBlocked) return 'budget_blocked'
  if (hasStaleBlocked) return 'stale_blocked'
  if (hasCancelled && hasSucceeded) return 'partial'
  if (hasCancelled && !hasSucceeded) return 'cancelled'
  if (hasSucceeded && !hasFailed && !hasRetryable && !hasTerminalFailure) return 'succeeded'
  if (hasFailed || hasRetryable || hasTerminalFailure) {
    if (hasSucceeded) return 'partial'
    return 'failed'
  }
  return 'none'
}

// ---------------------------------------------------------------------------
// 脱敏助手
// ---------------------------------------------------------------------------

const OCR_BATCH_SENSITIVE_KEYS = [
  'apiKey',
  'api_key',
  'authorization',
  'token',
  'secret',
  'password',
  'prompt',
  'promptHint',
  'dataUrl',
  'base64',
  'rawBody',
  'raw_body',
  'filePath',
  'absolutePath',
  'absolute_path',
  'storagePath',
  'storage_path',
  'fullText',
  'extractedText',
  'sourceBytes',
  'source_bytes',
  'normalizedBytes',
  'normalized_bytes',
]

/**
 * 脱敏 batch/queue 投影：剔除 full OCR text、raw provider payloads、prompt hints、
 * API keys、Authorization headers、source bytes、absolute paths、hidden source names。
 */
export function redactBatchAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const isSensitive = OCR_BATCH_SENSITIVE_KEYS.some((sk) =>
      key.toLowerCase().includes(sk.toLowerCase()),
    )
    redacted[key] = isSensitive ? '[REDACTED]' : value
  }
  return redacted
}

/**
 * 脱敏源名称：只展示 sourceAttachmentId（不含 file name 如果其为隐藏源）。
 */
export function redactSourceName(sourceFileName: string | null, isHidden: boolean): string | null {
  if (isHidden) return null
  return sourceFileName ?? null
}

/**
 * 脱敏 provider 摘要。
 */
export function redactBatchProviderSummary(provider: string | null, model: string | null): string {
  return [provider, model].filter(Boolean).join('/') || 'unknown'
}

// ---------------------------------------------------------------------------
// 确定性重试/退避辅助
// ---------------------------------------------------------------------------

/**
 * 计算重试退避延迟（指数退避 + 上限）。
 * delay = min(baseDelay × 2^(attemptCount - 1), maxDelay)
 */
export function computeRetryDelay(params: {
  attemptCount: number
  baseDelayMs?: number
  maxDelayMs?: number
}): number {
  const baseDelay = params.baseDelayMs ?? OCR_QUEUE_DEFAULT_RETRY_BASE_DELAY_MS
  const maxDelay = params.maxDelayMs ?? OCR_QUEUE_DEFAULT_RETRY_MAX_DELAY_MS
  const exponential = baseDelay * Math.pow(2, Math.max(0, params.attemptCount - 1))
  return Math.min(exponential, maxDelay)
}

/**
 * 判断错误类别是否为可重试的。
 */
export function isRetryableFailure(category: OcrQueueFailureCategory): boolean {
  const retryable: OcrQueueFailureCategory[] = [
    'timeout',
    'rate_limit',
    'unavailable',
    'malformed_response',
    'rate_limited',
    'unknown',
  ]
  return retryable.includes(category)
}

/**
 * 判断错误类别是否为终端故障。
 */
export function isTerminalFailure(category: OcrQueueFailureCategory): boolean {
  const terminal: OcrQueueFailureCategory[] = ['auth', 'capability_mismatch', 'exhausted_attempts']
  return terminal.includes(category)
}

/**
 * 计算 nextAttemptAt：now + retryDelay（ISO string）。
 * now 可注入（fake clock），默认使用 Date.now()。
 */
export function computeNextAttemptAt(retryDelayMs: number, now?: number): string {
  const base = now ?? Date.now()
  return new Date(base + retryDelayMs).toISOString()
}

/**
 * 判断锁是否过期（stale lock）。
 */
export function isLockStale(lockedAt: string, staleMs?: number): boolean {
  const stale = staleMs ?? OCR_QUEUE_DEFAULT_STALE_LOCK_MS
  return Date.now() - new Date(lockedAt).getTime() > stale
}

// ---------------------------------------------------------------------------
// 允许动作辅助
// ---------------------------------------------------------------------------

/**
 * 从 batch status 和用户权限解析允许的动作。
 */
export function resolveBatchAllowedActions(params: {
  status: OcrBatchStatus
  canView: boolean
  canCreate: boolean
  canManage: boolean
}): OcrBatchAllowedAction[] {
  const actions: OcrBatchAllowedAction[] = []
  if (params.canView) {
    actions.push('view', 'inspect_queue')
  }
  if (params.canCreate) {
    actions.push('create')
  }
  if (params.canManage) {
    const retryable = OCR_BATCH_RETRYABLE_STATUSES.includes(params.status)
    const cancellable: OcrBatchStatus[] = ['queued', 'processing', 'partial', 'paused']
    const resumable: OcrBatchStatus[] = ['paused']
    if (retryable) actions.push('retry')
    if (cancellable.includes(params.status)) actions.push('cancel')
    if (resumable.includes(params.status)) actions.push('resume')
  }
  return actions
}

/**
 * 判断 batch 状态是否为终端。
 */
export function isOcrBatchTerminal(status: OcrBatchStatus): boolean {
  return OCR_BATCH_TERMINAL_STATUSES.includes(status)
}

/**
 * 判断 queue item 状态是否为终端。
 */
export function isOcrQueueItemTerminal(status: OcrQueueItemStatus): boolean {
  return OCR_QUEUE_TERMINAL_STATUSES.includes(status)
}

// ---------------------------------------------------------------------------
// Queue 状态迁移
// ---------------------------------------------------------------------------

export const OCR_QUEUE_ITEM_RETRYABLE_STATUSES: readonly OcrQueueItemStatus[] = [
  'failed',
  'retryable',
  'budget_blocked',
  'rate_limited',
  'stale_blocked',
  'retention_blocked',
]

export function isOcrQueueItemRetryable(status: OcrQueueItemStatus): boolean {
  return OCR_QUEUE_ITEM_RETRYABLE_STATUSES.includes(status)
}

export function isValidQueueItemStatusTransition(
  from: OcrQueueItemStatus,
  to: OcrQueueItemStatus,
): boolean {
  const allowed: Record<OcrQueueItemStatus, readonly OcrQueueItemStatus[]> = {
    queued: ['claimed', 'cancelled', 'stale_blocked', 'retention_blocked'],
    claimed: ['processing', 'failed', 'cancelled'],
    processing: ['succeeded', 'failed', 'cancelled', 'retryable'],
    succeeded: ['cancelled'],
    failed: ['retryable', 'cancelled', 'terminal_failure'],
    retryable: ['queued', 'cancelled'],
    budget_blocked: ['retryable', 'queued', 'cancelled'],
    rate_limited: ['retryable', 'queued', 'cancelled'],
    stale_blocked: ['retryable', 'canceled' as OcrQueueItemStatus, 'cancelled'],
    cancelled: [],
    terminal_failure: [],
    retention_blocked: ['retryable', 'cancelled'],
  }
  return (allowed[from] as readonly string[]).includes(to)
}
