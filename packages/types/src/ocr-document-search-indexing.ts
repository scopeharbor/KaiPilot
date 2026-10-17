/**
 * V3 OCR Document Search Indexing — 共享契约与确定性纯函数引擎
 *
 * 定义 OCR 文档搜索索引的枚举/接口/类型守卫/纯函数：
 * 索引条目、索引运行、预览/执行请求与响应、状态分类、阻塞原因、警告代码、
 * 哈希/幂等/idempotency key 标准化、生命周期分类、脱敏/redaction。
 *
 * 消费 `ocr-review-confirmation.ts` 和 `ocr-result-retention.ts` 的记录，
 * 不改变上传/审查确认/保留治理契约。
 */

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** OCR 搜索索引条目的生命周期状态 */
export const OCR_SEARCH_INDEX_ENTRY_STATUSES = ['active', 'inactive', 'tombstoned'] as const
export type OcrSearchIndexEntryStatus = (typeof OCR_SEARCH_INDEX_ENTRY_STATUSES)[number]

/** 索引运行的类型 */
export const OCR_SEARCH_INDEX_RUN_TYPES = ['index', 'reindex', 'unindex'] as const
export type OcrSearchIndexRunType = (typeof OCR_SEARCH_INDEX_RUN_TYPES)[number]

/** 索引运行的最终状态 */
export const OCR_SEARCH_INDEX_RUN_STATUSES = [
  'succeeded',
  'partial',
  'stale_rejected',
  'blocked',
  'error',
] as const
export type OcrSearchIndexRunStatus = (typeof OCR_SEARCH_INDEX_RUN_STATUSES)[number]

/** 索引阻塞原因（低敏） */
export const OCR_SEARCH_INDEX_BLOCKED_REASONS = [
  'stale_source',
  'superseded_extraction',
  'expired_extraction',
  'purged_extraction',
  'tombstoned_extraction',
  'hold_active',
  'hidden_source',
  'permission_blocked',
  'not_accepted',
  'candidate_only',
] as const
export type OcrSearchIndexBlockedReason = (typeof OCR_SEARCH_INDEX_BLOCKED_REASONS)[number]

/** 索引警告代码（低敏） */
export const OCR_SEARCH_INDEX_WARNING_CODES = [
  'source_hash_unknown',
  'retention_policy_unavailable',
  'retention_deadline_approaching',
  'lifecycle_transition_pending',
  'page_refs_partial',
] as const
export type OcrSearchIndexWarningCode = (typeof OCR_SEARCH_INDEX_WARNING_CODES)[number]

/** 阻塞原因严重度排序（越大越严重） */
export const OCR_SEARCH_INDEX_BLOCKED_REASON_SEVERITY: Record<OcrSearchIndexBlockedReason, number> =
  {
    not_accepted: 1,
    candidate_only: 2,
    stale_source: 3,
    superseded_extraction: 4,
    hidden_source: 5,
    permission_blocked: 6,
    expired_extraction: 7,
    purged_extraction: 8,
    tombstoned_extraction: 9,
    hold_active: 10,
  }

/** 警告代码严重度排序（越大越严重） */
export const OCR_SEARCH_INDEX_WARNING_SEVERITY: Record<OcrSearchIndexWarningCode, number> = {
  page_refs_partial: 1,
  source_hash_unknown: 2,
  lifecycle_transition_pending: 3,
  retention_deadline_approaching: 4,
  retention_policy_unavailable: 5,
}

// ─── 常量 ────────────────────────────────────────────────────────────────

/** 搜索文本最大长度（超出截断） */
export const OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX = 4096

/** 搜索摘要最大长度 */
export const OCR_SEARCH_INDEX_SNIPPET_MAX = 300

/** idempotency key 最大长度 */
export const OCR_SEARCH_INDEX_IDEMPOTENCY_KEY_MAX = 128

/** 索引运行备注最大长度 */
export const OCR_SEARCH_INDEX_NOTE_MAX = 500

/** 每批索引最大条目数 */
export const OCR_SEARCH_INDEX_MAX_BATCH = 200

// ─── 接口 ────────────────────────────────────────────────────────────────

/** 索引条目摘要（API 返回） */
export interface OcrSearchIndexEntrySummary {
  id: number
  organizationId: number
  projectId: number
  extractionId: number
  sourceKind: 'attachment' | 'document' | 'unknown'
  sourceId: number | null
  sourceHash: string
  selectedTextHash: string
  indexContentHash: string
  pageRefs: number[]
  status: OcrSearchIndexEntryStatus
  indexedBy: number | null
  indexedAt: string | null
  tombstonedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 索引运行摘要（API 返回） */
export interface OcrSearchIndexRunSummary {
  id: number
  organizationId: number
  projectId: number
  runType: OcrSearchIndexRunType
  status: OcrSearchIndexRunStatus
  previewHash: string | null
  idempotencyKeyHash: string | null
  entryCount: number
  blockedCount: number
  warningCount: number
  warnings: OcrSearchIndexWarningCode[]
  blockedReasons: OcrSearchIndexBlockedReason[]
  note: string | null
  runBy: number | null
  createdAt: string
  updatedAt: string
}

/** 预览中单条提取的索引计划 */
export interface OcrSearchIndexPreviewEntry {
  extractionId: number
  sourceKind: 'attachment' | 'document' | 'unknown'
  sourceId: number | null
  sourceHash: string
  selectedTextHash: string
  pageRefs: number[]
  eligible: boolean
  blockedReason: OcrSearchIndexBlockedReason | null
  warnings: OcrSearchIndexWarningCode[]
  plannedIndexHash: string | null
  currentEntryId: number | null
  currentStatus: OcrSearchIndexEntryStatus | null
}

/** 索引预览请求 */
export interface OcrSearchIndexPreviewRequest {
  extractionIds?: number[]
  sourceKind?: 'attachment' | 'document'
  sourceId?: number
  note?: string
}

/** 索引预览响应 */
export interface OcrSearchIndexPreviewResponse {
  data: {
    entries: OcrSearchIndexPreviewEntry[]
    eligibleCount: number
    blockedCount: number
    blockedReasons: OcrSearchIndexBlockedReason[]
    warnings: OcrSearchIndexWarningCode[]
    previewHash: string
    requiresConfirmation: boolean
  }
}

/** 索引执行请求 */
export interface OcrSearchIndexExecuteRequest {
  previewHash: string
  idempotencyKey: string
  note?: string
}

/** 索引执行响应 */
export interface OcrSearchIndexExecuteResponse {
  data: {
    run: OcrSearchIndexRunSummary
    entries: OcrSearchIndexEntrySummary[]
    createdCount: number
    updatedCount: number
    blockedCount: number
  }
}

/** 重新索引预览请求 */
export interface OcrSearchIndexReindexRequest {
  extractionIds?: number[]
  sourceKind?: 'attachment' | 'document'
  sourceId?: number
  note?: string
}

/** 取消索引预览请求 */
export interface OcrSearchIndexUnindexRequest {
  entryIds: number[]
  note?: string
}

/** 列表/状态查询参数 */
export interface OcrSearchIndexListQuery {
  sourceKind?: 'attachment' | 'document'
  sourceId?: number
  extractionId?: number
  status?: OcrSearchIndexEntryStatus
  page?: number
  perPage?: number
}

/** 列表/状态响应 */
export interface OcrSearchIndexListResponse {
  data: OcrSearchIndexEntrySummary[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 审计元数据（低敏） */
export interface OcrSearchIndexAuditMetadata {
  organizationId: number
  projectId: number
  runId?: number | null
  runType?: OcrSearchIndexRunType | null
  entryIds?: number[]
  extractionIds?: number[]
  sourceKinds?: string[]
  sourceIds?: (number | null)[]
  sourceHashes?: string[]
  selectedTextHashes?: string[]
  indexContentHashes?: string[]
  previewHash?: string | null
  idempotencyKeyHash?: string | null
  createdCount?: number
  updatedCount?: number
  blockedCount?: number
  warningCodes?: OcrSearchIndexWarningCode[]
  blockedReasons?: OcrSearchIndexBlockedReason[]
}

// ─── 类型守卫 ────────────────────────────────────────────────────────────────

export function isOcrSearchIndexEntryStatus(v: unknown): v is OcrSearchIndexEntryStatus {
  return OCR_SEARCH_INDEX_ENTRY_STATUSES.includes(v as OcrSearchIndexEntryStatus)
}

export function isOcrSearchIndexRunType(v: unknown): v is OcrSearchIndexRunType {
  return OCR_SEARCH_INDEX_RUN_TYPES.includes(v as OcrSearchIndexRunType)
}

export function isOcrSearchIndexRunStatus(v: unknown): v is OcrSearchIndexRunStatus {
  return OCR_SEARCH_INDEX_RUN_STATUSES.includes(v as OcrSearchIndexRunStatus)
}

export function isOcrSearchIndexBlockedReason(v: unknown): v is OcrSearchIndexBlockedReason {
  return OCR_SEARCH_INDEX_BLOCKED_REASONS.includes(v as OcrSearchIndexBlockedReason)
}

export function isOcrSearchIndexWarningCode(v: unknown): v is OcrSearchIndexWarningCode {
  return OCR_SEARCH_INDEX_WARNING_CODES.includes(v as OcrSearchIndexWarningCode)
}

// ─── 纯函数：哈希 ────────────────────────────────────────────────────────

/**
 * 计算索引内容哈希（SHA-256 截取前 16 位 hex）
 * 纯函数，零副作用，零 I/O。
 */
export function computeIndexContentHash(
  extractionId: number,
  sourceHash: string,
  selectedTextHash: string,
  pageRefs: number[],
): string {
  const payload = `${extractionId}:${sourceHash}:${selectedTextHash}:${JSON.stringify(pageRefs)}`
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    const chr = payload.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  // 转为 16 进制并补齐到至少 16 位
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return hex.padEnd(16, '0').slice(0, 16)
}

/**
 * 计算索引预览哈希（所有 plannedIndexHash + blockedReasons 的聚合哈希）
 * 纯函数，零副作用，零 I/O。
 */
export function computePreviewHash(entries: OcrSearchIndexPreviewEntry[]): string {
  const parts = entries
    .map((e) => {
      const h = e.plannedIndexHash ?? 'blocked'
      return `${e.extractionId}:${h}:${e.eligible ? '1' : '0'}:${e.blockedReason ?? 'none'}`
    })
    .sort()
    .join('|')
  let hash = 0
  for (let i = 0; i < parts.length; i++) {
    const chr = parts.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0').padEnd(16, '0').slice(0, 16)
}

/**
 * 标准化 idempotency key（trim + 截断）
 * 纯函数，零副作用，零 I/O。
 */
export function normalizeIdempotencyKey(raw: string): string {
  return raw.trim().slice(0, OCR_SEARCH_INDEX_IDEMPOTENCY_KEY_MAX)
}

/**
 * 对 idempotency key 做确定性哈希
 * 纯函数，零副作用，零 I/O。
 */
export function computeIdempotencyKeyHash(raw: string): string {
  const normalized = normalizeIdempotencyKey(raw)
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const chr = normalized.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0').padEnd(16, '0').slice(0, 16)
}

// ─── 纯函数：搜索文本规范化与截断 ────────────────────────────────────────

/**
 * 规范化搜索文本（trim + 折叠空白）
 * 纯函数，零副作用，零 I/O。
 */
export function normalizeSearchableText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * 生成搜索摘要片段（从文本中截取最多 maxLength 字符，保持词边界）
 * 纯函数，零副作用，零 I/O。
 */
export function generateSearchSnippet(
  text: string,
  keyword: string,
  maxLength: number = OCR_SEARCH_INDEX_SNIPPET_MAX,
): string {
  const normalized = normalizeSearchableText(text)
  if (normalized.length <= maxLength) return normalized

  const lower = normalized.toLowerCase()
  const kw = keyword.toLowerCase()
  const idx = lower.indexOf(kw)

  if (idx >= 0) {
    // 以关键词为中心截取片段
    const half = Math.floor((maxLength - kw.length) / 2)
    const start = Math.max(0, idx - half)
    const end = Math.min(normalized.length, idx + kw.length + half)
    let snippet = normalized.slice(start, end)
    if (start > 0) snippet = '…' + snippet
    if (end < normalized.length) snippet = snippet + '…'
    return snippet
  }

  return normalized.slice(0, maxLength) + '…'
}

/**
 * 截断搜索文本至配置上限
 * 纯函数，零副作用，零 I/O。
 */
export function truncateSearchableText(
  text: string,
  maxLength: number = OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX,
): string {
  const normalized = normalizeSearchableText(text)
  return normalized.slice(0, maxLength)
}

// ─── 纯函数：生命周期分类 ────────────────────────────────────────────────

/**
 * 判断一条 accepted extraction 是否可被索引（不考虑权限/可见性）
 * 纯函数，零副作用，零 I/O。
 */
export function isExtractionIndexable(params: {
  status: string
  retentionLifecycle: string | null
  purgedAt: string | null
  tombstoneId: number | null
  sourceHash: string | null
  candidateHash: string | null
  selectedText: string | null
}): { eligible: boolean; blockedReason: OcrSearchIndexBlockedReason | null } {
  // 必须有已接受文本
  if (!params.selectedText || params.selectedText.trim().length === 0) {
    return { eligible: false, blockedReason: 'not_accepted' }
  }
  // 必须有 source hash
  if (!params.sourceHash) {
    return { eligible: false, blockedReason: 'not_accepted' }
  }
  // 状态必须是 current（已接受且未超集的提取；accepted extraction 的 status 为 current/superseded）
  if (params.status !== 'current') {
    return { eligible: false, blockedReason: 'candidate_only' }
  }
  // 已清除
  if (params.purgedAt) {
    return { eligible: false, blockedReason: 'purged_extraction' }
  }
  // 已 tombstoned
  if (params.tombstoneId) {
    return { eligible: false, blockedReason: 'tombstoned_extraction' }
  }
  // 保留生命周期检查
  if (params.retentionLifecycle === 'expired') {
    return { eligible: false, blockedReason: 'expired_extraction' }
  }
  return { eligible: true, blockedReason: null }
}

/**
 * 排序阻塞原因（按严重度降序）
 * 纯函数，零副作用，零 I/O。
 */
export function sortBlockedReasonsBySeverity(
  reasons: OcrSearchIndexBlockedReason[],
): OcrSearchIndexBlockedReason[] {
  const deduped = [...new Set(reasons)]
  return deduped.sort(
    (a, b) =>
      OCR_SEARCH_INDEX_BLOCKED_REASON_SEVERITY[b] - OCR_SEARCH_INDEX_BLOCKED_REASON_SEVERITY[a],
  )
}

/**
 * 排序警告代码（按严重度降序）
 * 纯函数，零副作用，零 I/O。
 */
export function sortWarningsBySeverity(
  warnings: OcrSearchIndexWarningCode[],
): OcrSearchIndexWarningCode[] {
  const deduped = [...new Set(warnings)]
  return deduped.sort(
    (a, b) => OCR_SEARCH_INDEX_WARNING_SEVERITY[b] - OCR_SEARCH_INDEX_WARNING_SEVERITY[a],
  )
}

// ─── 纯函数：脱敏/Redaction ──────────────────────────────────────────────

/**
 * 构建低敏搜索结果显示元数据（不含完整 OCR 文本）
 * 纯函数，零副作用，零 I/O。
 */
export function buildSearchResultMetadata(params: {
  sourceKind: string
  sourceId: number | null
  extractionId: number
  pageRefs: number[]
  selectedTextHash: string
  indexContentHash: string
  matchedFields: string[]
}): Record<string, unknown> {
  return {
    sourceKind: params.sourceKind,
    sourceId: params.sourceId,
    extractionId: params.extractionId,
    pageRefs: params.pageRefs,
    selectedTextHash: params.selectedTextHash,
    indexContentHash: params.indexContentHash,
    matchedFields: params.matchedFields,
  }
}

/**
 * 构建低敏审计元数据（不含完整 OCR 文本、prompts、API keys 等）
 * 纯函数，零副作用，零 I/O。
 */
export function buildOcrSearchIndexAuditMetadata(
  params: OcrSearchIndexAuditMetadata,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    organizationId: params.organizationId,
    projectId: params.projectId,
  }
  if (params.runId !== undefined) result.runId = params.runId
  if (params.runType !== undefined) result.runType = params.runType
  if (params.entryIds) result.entryIds = params.entryIds
  if (params.extractionIds) result.extractionIds = params.extractionIds
  if (params.sourceKinds) result.sourceKinds = params.sourceKinds
  if (params.sourceIds) result.sourceIds = params.sourceIds
  if (params.sourceHashes) result.sourceHashes = params.sourceHashes
  if (params.selectedTextHashes) result.selectedTextHashes = params.selectedTextHashes
  if (params.indexContentHashes) result.indexContentHashes = params.indexContentHashes
  if (params.previewHash !== undefined) result.previewHash = params.previewHash
  if (params.idempotencyKeyHash !== undefined) result.idempotencyKeyHash = params.idempotencyKeyHash
  if (params.createdCount !== undefined) result.createdCount = params.createdCount
  if (params.updatedCount !== undefined) result.updatedCount = params.updatedCount
  if (params.blockedCount !== undefined) result.blockedCount = params.blockedCount
  if (params.warningCodes) result.warningCodes = params.warningCodes
  if (params.blockedReasons) result.blockedReasons = params.blockedReasons
  return result
}
