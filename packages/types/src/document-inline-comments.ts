// document-inline-comments — V3 文档正文内联批注共享契约（前后端共享）。
//
// 范围：文档选区 anchor 元数据、评论线程复用、版本感知 stale 检测、RBAC/组织隔离
// 与低敏审计类型。不包含文档正文内容、全文搜索、实时协同编辑或外部同步。
//
// 枚举、DTO、请求/响应、审计元数据、权限安全脱敏摘要与纯函数均零运行时依赖，
// 可在前后端共享使用。

// ─── 常量 ────────────────────────────────────────────────────────────────

/** 单次选中引文最大长度（字符数）。超出时拒绝或截断。 */
export const DOCUMENT_INLINE_COMMENT_MAX_QUOTE_LENGTH = 500

/** 选中范围最小长度（字符数）。0 表示允许光标位 anchor（标记位置不引用文本）。 */
export const DOCUMENT_INLINE_COMMENT_MIN_RANGE_LENGTH = 0

/** 支持内联批注的文档类型。 */
export const SUPPORTED_INLINE_COMMENT_DOCUMENT_TYPES = ['document'] as const

/** 前后缀片段哈希长度（字符数），用于 snippet hash。 */
export const DOCUMENT_SNIPPET_HASH_LENGTH = 64

/** heading/location 摘要最大长度（字符数）。 */
export const DOCUMENT_HEADING_PATH_MAX_LENGTH = 200

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** Anchor 失效状态。 */
export const DOCUMENT_ANCHOR_STALE_STATUSES = [
  'fresh',
  'stale_content_changed',
  'stale_ambiguous_quote',
  'stale_missing_document',
  'stale_document_revision_missing',
] as const

export type DocumentAnchorStaleStatus = (typeof DOCUMENT_ANCHOR_STALE_STATUSES)[number]

/** 内联批注线程状态（委托给 root comment status）。 */
export const DOCUMENT_INLINE_THREAD_STATUSES = ['open', 'resolved'] as const

export type DocumentInlineThreadStatus = (typeof DOCUMENT_INLINE_THREAD_STATUSES)[number]

/** Anchor 排序字段。 */
export const DOCUMENT_ANCHOR_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'range_start',
  'stale_status',
] as const

export type DocumentAnchorSortField = (typeof DOCUMENT_ANCHOR_SORT_FIELDS)[number]

/** 内联批注列表过滤器 stale 状态。 */
export const DOCUMENT_ANCHOR_STALE_FILTERS = ['all', 'fresh', 'stale'] as const

export type DocumentAnchorStaleFilter = (typeof DOCUMENT_ANCHOR_STALE_FILTERS)[number]

// ─── 类型守卫 ────────────────────────────────────────────────────────────────

export function isDocumentAnchorStaleStatus(v: unknown): v is DocumentAnchorStaleStatus {
  return typeof v === 'string' && (DOCUMENT_ANCHOR_STALE_STATUSES as readonly string[]).includes(v)
}

export function isDocumentInlineThreadStatus(v: unknown): v is DocumentInlineThreadStatus {
  return typeof v === 'string' && (DOCUMENT_INLINE_THREAD_STATUSES as readonly string[]).includes(v)
}

export function isDocumentAnchorSortField(v: unknown): v is DocumentAnchorSortField {
  return typeof v === 'string' && (DOCUMENT_ANCHOR_SORT_FIELDS as readonly string[]).includes(v)
}

export function isDocumentAnchorStaleFilter(v: unknown): v is DocumentAnchorStaleFilter {
  return typeof v === 'string' && (DOCUMENT_ANCHOR_STALE_FILTERS as readonly string[]).includes(v)
}

// ─── 基础 DTO ────────────────────────────────────────────────────────────────

/** Anchor 元数据（不含 root comment body/replies）。 */
export interface DocumentCommentAnchorDTO {
  id: number
  organizationId: number
  projectId: number
  documentId: number
  rootCommentId: number

  /** 文档版本标识（后端可用 content hash 或 revision 列）。 */
  documentVersion: string
  /** 创建 anchor 时的文档内容哈希。 */
  contentHash: string

  /** 选中范围（0-based source text offsets）。 */
  rangeStart: number
  rangeEnd: number

  /** 选中的文本引文（限制长度）。 */
  selectedQuote: string

  /** 前缀/后缀 snippet 哈希（用于 stale 检测，不存原文）。 */
  prefixHash: string
  suffixHash: string

  /** 安全的位置摘要（如 heading 路径）。 */
  headingPath: string | null

  /** 失效状态。 */
  staleStatus: DocumentAnchorStaleStatus
  /** 失效原因（当 staleStatus !== 'fresh' 时）。 */
  staleReason: string | null

  /** 是否有未解决的回复。 */
  hasUnresolvedReplies: boolean

  createdAt: string
  updatedAt: string
}

/** 内联批注列表项（含 root comment 摘要）。 */
export interface DocumentInlineCommentListItem {
  anchor: DocumentCommentAnchorDTO
  /** root comment 摘要（不含完整 body，仅首行预览）。 */
  rootComment: {
    id: number
    authorId: number
    authorName: string
    authorAvatarUrl: string | null
    bodyPreview: string
    status: DocumentInlineThreadStatus
    replyCount: number
    createdAt: string
    updatedAt: string
  }
}

/** 内联批注详情（含完整 root comment 和 replies）。 */
export interface DocumentInlineCommentDetail {
  anchor: DocumentCommentAnchorDTO
  rootComment: {
    id: number
    authorId: number
    authorName: string
    authorAvatarUrl: string | null
    body: string
    bodyFormat: 'plain' | 'markdown'
    status: DocumentInlineThreadStatus
    replyCount: number
    createdAt: string
    updatedAt: string
  }
  replies: Array<{
    id: number
    authorId: number
    authorName: string
    authorAvatarUrl: string | null
    body: string
    bodyFormat: 'plain' | 'markdown'
    createdAt: string
    updatedAt: string
  }>
  /** 当前用户的权限摘要。 */
  permissions: DocumentInlineCommentPermissions
}

/** 当前用户对内联批注的操作权限。 */
export interface DocumentInlineCommentPermissions {
  canView: boolean
  canCreate: boolean
  canReply: boolean
  canEditSelf: boolean
  canDeleteSelf: boolean
  canModerate: boolean
  canResolve: boolean
  canReopen: boolean
  canReanchor: boolean
}

/** 权限安全的脱敏摘要（权限拒绝时返回）。 */
export interface DocumentInlineCommentRedactedSummary {
  anchorCount: null
  reason: 'permission_denied' | 'document_not_found' | 'unsupported_document_type'
}

// ─── 请求 DTO ────────────────────────────────────────────────────────────────

/** 创建内联批注请求。 */
export interface CreateDocumentInlineCommentRequest {
  /** 选中范围（0-based source text offsets）。 */
  rangeStart: number
  rangeEnd: number
  /** 选中的文本引文（≤ DOCUMENT_INLINE_COMMENT_MAX_QUOTE_LENGTH）。 */
  selectedQuote: string
  /** 文档版本标识（客户端传入当前文档 revision/hash）。 */
  documentVersion: string
  /** root comment 正文。 */
  body: string
  /** 正文格式。 */
  bodyFormat?: 'plain' | 'markdown'
  /** @提及的用户 ID 列表。 */
  mentions?: number[]
}

/** 回复内联批注请求。 */
export interface CreateDocumentInlineReplyRequest {
  body: string
  bodyFormat?: 'plain' | 'markdown'
  mentions?: number[]
}

/** 重设 anchor 请求。 */
export interface ReanchorRequest {
  /** 新的选中范围（0-based source text offsets）。 */
  rangeStart: number
  rangeEnd: number
  /** 新的选中文本引文。 */
  selectedQuote: string
  /** 新的文档版本标识。 */
  documentVersion: string
}

/** 列表查询参数。 */
export interface ListDocumentInlineCommentsQuery {
  page?: number
  perPage?: number
  sort?: DocumentAnchorSortField
  staleFilter?: DocumentAnchorStaleFilter
  threadStatus?: DocumentInlineThreadStatus
}

// ─── 响应 DTO ────────────────────────────────────────────────────────────────

/** 列表响应。 */
export interface ListDocumentInlineCommentsResponse {
  data: DocumentInlineCommentListItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 单条详情响应。 */
export interface GetDocumentInlineCommentResponse {
  data: DocumentInlineCommentDetail
}

/** 创建/回复响应。 */
export interface CreateDocumentInlineCommentResponse {
  data: DocumentInlineCommentDetail
}

/** 重设 anchor 响应。 */
export interface ReanchorResponse {
  data: DocumentInlineCommentDetail
}

// ─── 审计元数据 ────────────────────────────────────────────────────────────────

/** 内联批注审计事件枚举。 */
export const DOCUMENT_INLINE_COMMENT_AUDIT_EVENTS = [
  'DOCUMENT_INLINE_ANCHOR_CREATED',
  'DOCUMENT_INLINE_ANCHOR_REANCHORED',
  'DOCUMENT_INLINE_ANCHOR_STALE_RECALCULATED',
  'DOCUMENT_INLINE_ANCHOR_RESOLVED',
  'DOCUMENT_INLINE_ANCHOR_REOPENED',
  'DOCUMENT_INLINE_ANCHOR_DELETED',
  'DOCUMENT_INLINE_ANCHOR_PERMISSION_DENIED',
] as const

export type DocumentInlineCommentAuditEvent = (typeof DOCUMENT_INLINE_COMMENT_AUDIT_EVENTS)[number]

/** 低敏审计 payload（不含文档正文/完整评论内容）。 */
export interface DocumentInlineCommentAuditMeta {
  event: DocumentInlineCommentAuditEvent
  organizationId: number
  projectId: number
  documentId: number
  anchorId?: number
  rootCommentId?: number
  documentVersion?: string
  rangeLength?: number
  staleStatus?: DocumentAnchorStaleStatus
  /** 内容哈希（不存原文）。 */
  contentHash?: string
}

// ─── 纯函数 ────────────────────────────────────────────────────────────────

/**
 * 计算内容哈希（简单确定性哈希，用于 stale 检测）。
 * 零运行时依赖，使用简单的 FNV-1a 算法。
 */
export function computeDocumentContentHash(content: string): string {
  let hash = 2166136261
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash = hash >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 计算 snippet 哈希（前后缀）。取文本前后各 DOCUMENT_SNIPPET_HASH_LENGTH 字符。
 */
export function computeSnippetHash(text: string, position: 'prefix' | 'suffix'): string {
  if (position === 'prefix') {
    return computeDocumentContentHash(text.slice(0, DOCUMENT_SNIPPET_HASH_LENGTH))
  }
  return computeDocumentContentHash(text.slice(-DOCUMENT_SNIPPET_HASH_LENGTH))
}

/**
 * 归一化范围：确保 start ≤ end，0-based。
 */
export function normalizeRange(
  rangeStart: number,
  rangeEnd: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(rangeStart, rangeEnd))
  const end = Math.max(rangeStart, rangeEnd)
  return { start, end }
}

/**
 * 验证选中文档文本范围是否有效。
 */
export function validateDocumentRange(
  rangeStart: number,
  rangeEnd: number,
  contentLength: number,
): { valid: false; error: string } | { valid: true } {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
    return { valid: false, error: '范围值必须为有效数字' }
  }
  if (rangeStart < 0 || rangeEnd < 0) {
    return { valid: false, error: '范围不能为负数' }
  }
  if (rangeStart > contentLength || rangeEnd > contentLength) {
    return { valid: false, error: '范围超出文档内容长度' }
  }
  const { start, end } = normalizeRange(rangeStart, rangeEnd)
  if (end - start > DOCUMENT_INLINE_COMMENT_MAX_QUOTE_LENGTH) {
    return {
      valid: false,
      error: `选中文本不能超过 ${DOCUMENT_INLINE_COMMENT_MAX_QUOTE_LENGTH} 字符`,
    }
  }
  return { valid: true }
}

/**
 * 验证 selected quote 大小。
 */
export function validateQuoteLength(
  quote: string,
): { valid: false; error: string } | { valid: true } {
  if (quote.length > DOCUMENT_INLINE_COMMENT_MAX_QUOTE_LENGTH) {
    return { valid: false, error: `引文不能超过 ${DOCUMENT_INLINE_COMMENT_MAX_QUOTE_LENGTH} 字符` }
  }
  return { valid: true }
}

/**
 * 生成 anchor 指纹（用于确定性幂等键）。
 */
export function computeAnchorFingerprint(
  documentId: number,
  contentHash: string,
  rangeStart: number,
  rangeEnd: number,
): string {
  const raw = `${documentId}:${contentHash}:${rangeStart}:${rangeEnd}`
  return computeDocumentContentHash(raw)
}

/**
 * 提取 heading/位置摘要。
 * 从文档内容中提取选中范围前的最近一个 heading（Markdown # 格式）。
 */
export function extractHeadingPath(content: string, rangeStart: number): string | null {
  if (!content || rangeStart <= 0) return null
  const beforeText = content.slice(0, rangeStart)
  const lines = beforeText.split('\n')
  const headings: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (match && match[2]) {
      headings.unshift(match[2].trim().slice(0, 80))
    }
  }
  if (headings.length === 0) return null
  const path = headings.join(' > ')
  if (path.length > DOCUMENT_HEADING_PATH_MAX_LENGTH) {
    // 去掉最后一个 heading 再试
    if (headings.length > 1) {
      const shorter = headings.slice(0, -1).join(' > ')
      if (shorter.length > DOCUMENT_HEADING_PATH_MAX_LENGTH) {
        return shorter.slice(0, DOCUMENT_HEADING_PATH_MAX_LENGTH - 3) + '...'
      }
      return shorter + ' > ...'
    }
    return path.slice(0, DOCUMENT_HEADING_PATH_MAX_LENGTH - 3) + '...'
  }
  return path
}

/**
 * 检测 anchor 是否因文档内容变化而失效。
 */
export function detectAnchorStaleness(
  storedContentHash: string,
  currentContentHash: string,
  storedPrefixHash: string,
  currentPrefixHash: string,
  storedSuffixHash: string,
  currentSuffixHash: string,
  currentContent: string,
  storedQuote: string,
  rangeStart: number,
  rangeEnd: number,
): { staleStatus: DocumentAnchorStaleStatus; staleReason: string | null } {
  if (!currentContent) {
    return {
      staleStatus: 'stale_missing_document',
      staleReason: '文档内容不可用',
    }
  }

  // 内容哈希完全匹配 → fresh
  if (storedContentHash === currentContentHash) {
    return { staleStatus: 'fresh', staleReason: null }
  }

  // 先检查 quote 是否仍能在当前内容中唯一定位
  if (storedQuote) {
    const { start, end } = normalizeRange(rangeStart, rangeEnd)
    const currentSlice = currentContent.slice(start, end)
    if (currentSlice !== storedQuote) {
      // 检查 quote 是否在附近能找到
      const searchWindow = currentContent.slice(
        Math.max(0, start - 200),
        Math.min(currentContent.length, end + 200),
      )
      const count = (searchWindow.match(new RegExp(escapeRegExp(storedQuote), 'g')) || []).length
      if (count === 0) {
        return {
          staleStatus: 'stale_ambiguous_quote',
          staleReason: '原引文在文档中已不存在',
        }
      }
      if (count > 1) {
        return {
          staleStatus: 'stale_ambiguous_quote',
          staleReason: `原引文在附近出现 ${count} 次，无法唯一定位`,
        }
      }
      // count === 1 但位置偏移 → 仍可定位但内容已变
      return {
        staleStatus: 'stale_content_changed',
        staleReason: '文档内容已变更，引文位置可能偏移',
      }
    }
  }

  // 检查前后缀 snippet hash
  const prefixChanged = storedPrefixHash !== currentPrefixHash
  const suffixChanged = storedSuffixHash !== currentSuffixHash

  if (prefixChanged || suffixChanged) {
    return {
      staleStatus: 'stale_content_changed',
      staleReason: `文档内容已变更：${prefixChanged ? '前缀不匹配' : ''}${prefixChanged && suffixChanged ? '，' : ''}${suffixChanged ? '后缀不匹配' : ''}`,
    }
  }

  return { staleStatus: 'fresh', staleReason: null }
}

/** 转义正则特殊字符。 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 确定性 stale 状态转移验证。
 * 某些状态转移是非法的（如 fresh → stale_missing_document 仅当文档被删除）。
 */
export function isValidStaleTransition(
  from: DocumentAnchorStaleStatus,
  to: DocumentAnchorStaleStatus,
): boolean {
  // 所有状态都可变为 fresh（通过 reanchor）
  if (to === 'fresh') return true
  // fresh 可变任何 stale 状态
  if (from === 'fresh') return true
  // stale 状态之间可以互相转移（to 已不为 fresh，from 已不为 fresh）
  return true
}

/**
 * 构建权限安全的脱敏摘要。
 */
export function buildRedactedSummary(
  reason: DocumentInlineCommentRedactedSummary['reason'],
): DocumentInlineCommentRedactedSummary {
  return { anchorCount: null, reason }
}

// ─── 夹具 builder ────────────────────────────────────────────────────────────────

export interface BuildAnchorDTOInput {
  id?: number
  organizationId?: number
  projectId?: number
  documentId?: number
  rootCommentId?: number
  documentVersion?: string
  contentHash?: string
  rangeStart?: number
  rangeEnd?: number
  selectedQuote?: string
  prefixHash?: string
  suffixHash?: string
  headingPath?: string | null
  staleStatus?: DocumentAnchorStaleStatus
  staleReason?: string | null
  hasUnresolvedReplies?: boolean
  createdAt?: string
  updatedAt?: string
}

export function buildAnchorDTO(overrides: BuildAnchorDTOInput = {}): DocumentCommentAnchorDTO {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? 1,
    organizationId: overrides.organizationId ?? 1,
    projectId: overrides.projectId ?? 1,
    documentId: overrides.documentId ?? 1,
    rootCommentId: overrides.rootCommentId ?? 1,
    documentVersion: overrides.documentVersion ?? 'v1',
    contentHash: overrides.contentHash ?? 'abc123',
    rangeStart: overrides.rangeStart ?? 10,
    rangeEnd: overrides.rangeEnd ?? 50,
    selectedQuote: overrides.selectedQuote ?? '这是一段被选中的文档文本。',
    prefixHash: overrides.prefixHash ?? 'prefix_hash_001',
    suffixHash: overrides.suffixHash ?? 'suffix_hash_001',
    headingPath: overrides.headingPath ?? '项目概述 > 需求分析',
    staleStatus: overrides.staleStatus ?? 'fresh',
    staleReason: overrides.staleReason ?? null,
    hasUnresolvedReplies: overrides.hasUnresolvedReplies ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

export function buildStaleAnchorDTO(overrides: BuildAnchorDTOInput = {}): DocumentCommentAnchorDTO {
  return buildAnchorDTO({
    staleStatus: 'stale_content_changed',
    staleReason: '文档内容已变更：前缀不匹配',
    selectedQuote: '过时的文档引用文本',
    ...overrides,
  })
}

export function buildPermissionDeniedSummary(): DocumentInlineCommentRedactedSummary {
  return buildRedactedSummary('permission_denied')
}

export function buildLargeDocumentAnchors(count: number = 100): DocumentCommentAnchorDTO[] {
  return Array.from({ length: count }, (_, i) =>
    buildAnchorDTO({
      id: i + 1,
      rangeStart: i * 10,
      rangeEnd: i * 10 + 40,
      headingPath: `第 ${i + 1} 章`,
    }),
  )
}
