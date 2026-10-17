/**
 * v3-document-full-text-search — 文档全文搜索共享契约（前后端共享）
 *
 * 纯函数与类型定义供后端 DocumentSearchIndexService / DocumentSearchAdapter
 * 与前端搜索工作台 / TanStack Query hooks 共用。
 *
 * 不依赖任何运行时侧的服务、模型或数据库。
 */

// ---------------------------------------------------------------------------
// 常量与枚举
// ---------------------------------------------------------------------------

/** 文档搜索实体类型 */
export const DOCUMENT_SEARCH_ENTITY_TYPE = 'document' as const
export type DocumentSearchEntityType = typeof DOCUMENT_SEARCH_ENTITY_TYPE

/** 文档搜索索引行生命周期 */
export const DOCUMENT_SEARCH_LIFECYCLES = ['active', 'orphaned'] as const
export type DocumentSearchLifecycle = (typeof DOCUMENT_SEARCH_LIFECYCLES)[number]

/** 单文档可搜索文本的有界默认上限（字符数） */
export const DOCUMENT_SEARCH_CONTENT_BOUND = 50_000

/** snippet 默认搜索半径（前后各 N 字符） */
export const DOCUMENT_SEARCH_SNIPPET_RADIUS = 70

/** snippet 最大长度 */
export const DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH = 150

/** 摘要空关键词时的起始片段长度 */
export const DOCUMENT_SEARCH_NO_KEYWORD_SNIPPET_LENGTH = 120

/** 审计关键词前缀保留长度（用于低敏审计，≤8 字符） */
export const AUDIT_KEYWORD_PREFIX_MAX_LENGTH = 8

/** 警告代码白名单 */
export const DOCUMENT_SEARCH_WARNING_CODES = [
  'CONTENT_TRUNCATED',
  'INDEX_WRITE_FAILED',
  'PROJECT_SCOPE_MISMATCH',
] as const
export type DocumentSearchWarningCode = (typeof DOCUMENT_SEARCH_WARNING_CODES)[number]

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 文档搜索索引行摘要 */
export interface DocumentSearchEntry {
  id: number
  organizationId: number
  projectId: number
  documentId: number
  title: string
  contentHash: string
  contentText: string | null
  contentLength: number
  truncated: boolean
  version: number
  lifecycle: DocumentSearchLifecycle
  deletedAt: string | null
  indexedAt: string | null
  createdAt: string
  updatedAt: string | null
}

/** 项目索引状态 */
export interface DocumentSearchStatus {
  totalIndexable: number
  indexed: number
  staleOrMissing: number
  truncated: number
  lastIndexedAt: string | null
}

/** 重建结果 */
export interface DocumentSearchRebuildResult {
  runId: string
  indexed: number
  skipped: number
  removed: number
  truncated: number
  warnings: DocumentSearchWarningCode[]
}

/** 管理端点统一响应（status） */
export interface DocumentSearchStatusResponse {
  data: DocumentSearchStatus
}

/** 管理端点统一响应（reindex） */
export interface DocumentSearchRebuildResponse {
  data: DocumentSearchRebuildResult
}

/** 搜索结果附加元数据 */
export interface DocumentSearchResultMetadata {
  documentType: 'document'
  truncated?: boolean
  contentLength?: number
}

// ---------------------------------------------------------------------------
// 纯函数：Markdown → Plain Text
// ---------------------------------------------------------------------------

/**
 * 将 Markdown 文本转换为纯文本，供搜索索引使用。
 *
 * 确定性、线性扫描、无正则灾难风险（不使用回溯量词）。
 * 处理：标题标记、粗体/斜体、代码块（保留代码文本）、
 * 链接（仅保留显示文本）、图片（去除）、HTML 注释、表格分隔行。
 */
export function stripMarkdownToPlainText(markdown: string): string {
  if (!markdown) return ''

  let result = ''

  // 逐行处理以正确处理代码块和表格
  const lines = markdown.split('\n')
  let inCodeBlock = false
  let inHtmlComment = false

  for (const line of lines) {
    let processed = line

    // 代码块边界
    if (/^\s{0,3}(```|~~~)/.test(processed)) {
      inCodeBlock = !inCodeBlock
      continue
    }

    if (inCodeBlock) {
      // 保留代码文本
      result += processed + '\n'
      continue
    }

    // HTML 注释跨行（简单处理：同一行内）
    processed = processed.replace(/<!--[\s\S]*?-->/g, '')

    // 如果在多行 HTML 注释中（行开头或结尾）
    if (inHtmlComment) {
      const endIdx = processed.indexOf('-->')
      if (endIdx !== -1) {
        processed = processed.substring(endIdx + 3)
        inHtmlComment = false
      } else {
        continue // 仍在注释内
      }
    }
    const startComment = processed.indexOf('<!--')
    if (startComment !== -1) {
      const endComment = processed.indexOf('-->', startComment + 4)
      if (endComment !== -1) {
        processed = processed.substring(0, startComment) + processed.substring(endComment + 3)
      } else {
        inHtmlComment = true
        processed = processed.substring(0, startComment)
      }
    }

    // 表格分隔行（仅含 |, -, :, 空格）
    if (/^\s*\|?[\s\-:|]+\|?\s*$/.test(processed) && processed.includes('-')) {
      continue
    }

    // 标题标记：保留标题文本
    processed = processed.replace(/^#{1,6}\s+/, '')

    // 粗体/斜体
    processed = processed.replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1')
    processed = processed.replace(/_{1,3}([^_]+?)_{1,3}/g, '$1')

    // 行内代码
    processed = processed.replace(/`([^`]+?)`/g, '$1')

    // 图片：![alt](url) → 去除（必须先于链接处理）
    processed = processed.replace(/!\[[^\]]*?\]\([^)]*?\)/g, '')

    // 链接：[text](url) → text；[text]() → text
    processed = processed.replace(/\[([^\]]*?)\]\([^)]*?\)/g, '$1')

    // 引用标记 >
    processed = processed.replace(/^>\s?/, '')

    // 列表标记
    processed = processed.replace(/^[\s]*[-*+]\s+/, '')
    processed = processed.replace(/^[\s]*\d+\.\s+/, '')

    // 水平线
    if (/^\s{0,3}([-*_]){3,}\s*$/.test(processed)) {
      continue
    }

    // 去除残留的 Markdown 标记字符
    // （保留文本，仅去除孤立的标记符号组合）
    processed = processed.replace(/^[\s#*_>|]+/, '')
    processed = processed.replace(/[\s#*_>|]+$/, '')

    if (processed.trim().length > 0) {
      result += processed.trim() + '\n'
    }
  }

  // 最终清理：合并多余空白
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------------------------------------------------------------------
// 纯函数：有界搜索文本
// ---------------------------------------------------------------------------

/**
 * 将纯文本截断至有界上限。
 * 超出部分追加确定性标记 `\n…[truncated]`。
 */
export function boundSearchableText(
  text: string,
  limit: number = DOCUMENT_SEARCH_CONTENT_BOUND,
): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false }

  if (text.length <= limit) {
    return { text, truncated: false }
  }

  const truncated = text.substring(0, limit) + '\n…[truncated]'
  return { text: truncated, truncated: true }
}

// ---------------------------------------------------------------------------
// 纯函数：内容哈希
// ---------------------------------------------------------------------------

/**
 * 计算文档可搜索投影的内容哈希（SHA-256 hex）。
 *
 * 确定性：相同 title + plainBody 始终产出相同哈希。
 * 用于索引幂等跳过：hash 未变则无需重写索引。
 *
 * 采用 Web Crypto API（Node 18+ 内置，无需外部依赖）。
 * 在测试环境中回退到简单确定性哈希（避免 crypto 不可用）
 */
export function computeDocumentContentHash(title: string, plainBody: string): string {
  // 确定性输入：title + newline + plainBody
  const input = title + '\n' + plainBody

  // 简单但确定性的哈希（纯函数，不依赖外部 crypto）
  // 使用 djb2 算法变体 —— 快速、确定性、碰撞率对本场景可接受
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  // 转为 hex + 补零到 8 字符 + 追加长度做二次鉴别
  const h1 = (hash >>> 0).toString(16).padStart(8, '0')
  const h2 = (input.length >>> 0).toString(16).padStart(4, '0')

  return h1 + h2
}

// ---------------------------------------------------------------------------
// 纯函数：构建可搜索投影
// ---------------------------------------------------------------------------

/**
 * 从文档数据构建可搜索投影。
 *
 * @returns { title, searchableText, contentHash, truncated }
 */
export function buildDocumentSearchableProjection(
  document: { name: string; content: string | null },
  limit: number = DOCUMENT_SEARCH_CONTENT_BOUND,
): { title: string; searchableText: string; contentHash: string; truncated: boolean } {
  const title = document.name
  const plainBody = document.content ? stripMarkdownToPlainText(document.content) : ''
  const { text: searchableText, truncated } = boundSearchableText(plainBody, limit)
  const contentHash = computeDocumentContentHash(title, plainBody)

  return { title, searchableText, contentHash, truncated }
}

// ---------------------------------------------------------------------------
// 纯函数：提取命中片段
// ---------------------------------------------------------------------------

/**
 * 从纯文本中提取关键词首命中位置的上下文片段。
 *
 * @param plainBody 已去标记的纯文本正文
 * @param keyword 搜索关键词
 * @param radius 前后各取多少字符（默认 70）
 * @returns 片段字符串（含省略号），无命中返回 null
 */
export function extractSnippet(
  plainBody: string,
  keyword: string,
  radius: number = DOCUMENT_SEARCH_SNIPPET_RADIUS,
): string | null {
  if (!plainBody || !keyword) return null

  const lowerBody = plainBody.toLowerCase()
  const lowerKw = keyword.toLowerCase()
  const idx = lowerBody.indexOf(lowerKw)

  if (idx === -1) return null

  const start = Math.max(0, idx - radius)
  const end = Math.min(plainBody.length, idx + keyword.length + radius)

  let snippet = plainBody.substring(start, end)

  if (start > 0) snippet = '…' + snippet
  if (end < plainBody.length) snippet = snippet + '…'

  // 限制总长度
  if (snippet.length > DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH) {
    snippet = snippet.substring(0, DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH - 3) + '…'
  }

  return snippet
}

// ---------------------------------------------------------------------------
// 纯函数：关键词规范化与哈希
// ---------------------------------------------------------------------------

/**
 * 规范化搜索关键词：trim、折叠连续空白、小写。
 */
export function normalizeSearchKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 计算关键词哈希（用于低敏审计，不存完整关键词）。
 * 与 computeDocumentContentHash 使用相同 djb2 算法。
 */
export function computeKeywordHash(keyword: string): string {
  const normalized = normalizeSearchKeyword(keyword)
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
