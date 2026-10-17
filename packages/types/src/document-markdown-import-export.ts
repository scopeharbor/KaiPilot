// v3-document-markdown-import-export —— 项目文档 Markdown 导入/导出共享契约（前后端共用）。
// 覆盖：import preview / confirm 请求响应、单文档与选中文档树导出、export manifest、
// 警告码、限额、哈希纯函数、确定性排序与低敏审计 metadata 助手。
// 设计约束：解析确定性、无外部 URL fetch、无本地路径读取、无嵌入内容执行、无隐藏元数据泄露。

// ---------------------------------------------------------------------------
// 限额常量
// ---------------------------------------------------------------------------

export const MARKDOWN_IMPORT_MAX_BYTES = 100_000
export const MARKDOWN_IMPORT_MAX_LINES = 2000
export const MARKDOWN_IMPORT_MAX_TITLE_LENGTH = 255
export const MARKDOWN_EXPORT_MAX_FILENAME_LENGTH = 200
export const MARKDOWN_EXPORT_MAX_SNIPPET_LENGTH = 200
export const MARKDOWN_EXPORT_MAX_HEADING_DEPTH = 6
export const MARKDOWN_BUNDLE_MAX_ITEMS = 500
export const MARKDOWN_BUNDLE_MAX_BYTES = 500_000

// ---------------------------------------------------------------------------
// 枚举：模式 / 允许动作 / 状态
// ---------------------------------------------------------------------------

export const MARKDOWN_IMPORT_MODES = ['create', 'replace'] as const
export type MarkdownImportMode = (typeof MARKDOWN_IMPORT_MODES)[number]

export const MARKDOWN_ALLOWED_ACTIONS = ['import', 'replace', 'export'] as const
export type MarkdownAllowedAction = (typeof MARKDOWN_ALLOWED_ACTIONS)[number]

export const MARKDOWN_EXPORT_ITEM_STATUSES = ['exported', 'skipped', 'failed', 'denied'] as const
export type MarkdownExportItemStatus = (typeof MARKDOWN_EXPORT_ITEM_STATUSES)[number]

// ---------------------------------------------------------------------------
// 警告码（确定性、低敏、无隐藏信息）
// ---------------------------------------------------------------------------

export const MARKDOWN_WARNING_CODES = [
  'RAW_HTML',
  'REMOTE_IMAGE',
  'LOCAL_PATH_REFERENCE',
  'UNSUPPORTED_FRONTMATTER',
  'EXCESSIVE_HEADING_DEPTH',
  'OVERSIZED_CONTENT',
  'MISSING_CONTENT',
  'STALE_SOURCE',
  'HIDDEN_SOURCE_DENIAL',
] as const
export type MarkdownWarningCode = (typeof MARKDOWN_WARNING_CODES)[number]

export interface MarkdownWarning {
  code: MarkdownWarningCode
  message: string
  /** 安全片段或计数；绝不包含完整正文/路径/URL 原文细节（仅提示类型） */
  snippet?: string | null
  count?: number | null
}

// ---------------------------------------------------------------------------
// DTO：import preview
// ---------------------------------------------------------------------------

export interface MarkdownImportPreviewRequest {
  mode: MarkdownImportMode
  /** 原始 Markdown 文本（服务端将重新归一化并重算所有哈希） */
  content: string
  /** 来源文件名（可选，用于标题推断与安全文件名生成） */
  originalFilename?: string | null
  /** create 模式：目标父文件夹 id（null = 项目根） */
  parentId?: number | null
  /** replace 模式：目标文档 id */
  targetDocumentId?: number | null
  /** replace 模式：预览时已知的当前 sourceDocumentHash */
  expectedSourceDocumentHash?: string | null
}

export interface MarkdownImportPreviewTarget {
  mode: MarkdownImportMode
  targetDocumentId: number | null
  targetDocumentName: string | null
  parentId: number | null
}

export interface MarkdownImportPreview {
  mode: MarkdownImportMode
  normalizedContent: string
  inferredTitle: string | null
  safeTitle: string | null
  byteCount: number
  lineCount: number
  target: MarkdownImportPreviewTarget
  warnings: MarkdownWarning[]
  previewHash: string
  sourceDocumentHash: string | null
  /** 服务端计算的最低可用文件库权限动作 */
  allowedActions: MarkdownAllowedAction[]
}

// ---------------------------------------------------------------------------
// DTO：import confirm
// ---------------------------------------------------------------------------

export interface MarkdownImportConfirmRequest {
  mode: MarkdownImportMode
  /** 与 preview 一致的原始内容；服务端重新归一化并重算 previewHash */
  content: string
  originalFilename?: string | null
  parentId?: number | null
  targetDocumentId?: number | null
  /** 必须显式置 true，否则拒绝写入 */
  confirmed: boolean
  /** preview 返回的 previewHash */
  previewHash: string
  /** replace 模式：preview 返回的 sourceDocumentHash */
  expectedSourceDocumentHash?: string | null
}

export interface MarkdownImportConfirmResult {
  documentId: number
  mode: MarkdownImportMode
  name: string
  previewHash: string
  sourceDocumentHash: string | null
  byteCount: number
  warningCodes: MarkdownWarningCode[]
  createdAt: string | null
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// DTO：export
// ---------------------------------------------------------------------------

export interface MarkdownExportSingleRequest {
  documentId: number
}

export interface MarkdownExportSingleResult {
  filename: string
  content: string
  contentHash: string
  byteCount: number
  /** 源文档引用（仅 id 与安全标题，不含路径） */
  source: {
    documentId: number
    name: string
  }
}

export interface MarkdownExportTreeRequest {
  /** 选中的文档/文件夹 id（确定性去重后按树序处理） */
  selectedIds: number[]
  /** 供 UI 展示的树顺序参考；后端以自身确定性遍历为准 */
  includeChildren?: boolean
}

export interface MarkdownExportTreeItem {
  documentId: number
  /** 相对路径（文件夹名 + 文件名），隐藏项不出现 */
  path: string
  status: MarkdownExportItemStatus
  /** failed/denied 时给出低敏原因码；无标题/无内容泄露 */
  reasonCode?: MarkdownWarningCode | null
  byteCount?: number | null
  contentHash?: string | null
}

export interface MarkdownExportBundleManifest {
  exportedCount: number
  skippedCount: number
  failedCount: number
  deniedCount: number
  /** 确定性排序后的逐项结果（不泄露隐藏项标题） */
  items: MarkdownExportTreeItem[]
}

export interface MarkdownExportTreeResult {
  filename: string
  /** 完整 bundle 内容（manifest + 分隔文档） */
  content: string
  bundleHash: string
  byteCount: number
  manifest: MarkdownExportBundleManifest
}

// ---------------------------------------------------------------------------
// 纯函数：归一化 / 标题推断 / 安全文件名 / 片段
// ---------------------------------------------------------------------------

/** 去除 BOM 并把 \r\n 与 \r 归一化为 \n（确定性） */
export function normalizeMarkdownText(input: string): string {
  if (!input) return ''
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 从 frontmatter 提取 title 字段；无则返回 null */
export function extractFrontmatterTitle(input: string): string | null {
  const normalized = normalizeMarkdownText(input)
  if (!normalized.startsWith('---')) return null
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return null
  const frontmatter = normalized.slice(3, end)
  const titleMatch = frontmatter.match(/^title\s*:\s*(.+?)\s*$/m)
  if (!titleMatch) return null
  const rawTitle = titleMatch[1]
  if (!rawTitle) return null
  const title = rawTitle.replace(/^['"]|['"]$/g, '').trim()
  return title || null
}

/** 推断标题：frontmatter title → 首个 H1 → 文件名（去扩展名） */
export function inferMarkdownTitle(input: string, originalFilename?: string | null): string | null {
  const normalized = normalizeMarkdownText(input)
  const fromFrontmatter = extractFrontmatterTitle(normalized)
  if (fromFrontmatter) return fromFrontmatter
  const h1 = normalized.match(/^#\s+(.+?)\s*$/m)
  if (h1) {
    const heading = h1[1]
    if (heading && heading.trim()) return heading.trim()
  }
  if (originalFilename) {
    const base = originalFilename.replace(/\.md$/i, '').trim()
    return base || null
  }
  return null
}

/** 生成安全文件名：去非法字符、长度截断（保留 .md 后缀空间）、强制 .md 扩展名 */
export function safeMarkdownFilename(title: string | null, fallback = 'document'): string {
  let base = (title ?? fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
  if (!base) base = fallback
  if (!/\.md$/i.test(base)) {
    base = `${base.slice(0, MARKDOWN_EXPORT_MAX_FILENAME_LENGTH - 3)}.md`
  } else {
    base = base.slice(0, MARKDOWN_EXPORT_MAX_FILENAME_LENGTH)
  }
  return base
}

/** 有界片段提取：前 N 字符、单行折叠、无截断标记外的元数据 */
export function extractMarkdownSnippet(
  content: string,
  maxLength = MARKDOWN_EXPORT_MAX_SNIPPET_LENGTH,
): string {
  const normalized = normalizeMarkdownText(content)
  const singleLine = normalized.replace(/\n+/g, ' ').trim()
  return singleLine.slice(0, maxLength)
}

// ---------------------------------------------------------------------------
// 纯函数：哈希（FNV-1a，确定性）
// ---------------------------------------------------------------------------

export function markdownFnv1aHash(input: string): string {
  let h = BigInt('0xcbf29ce484222325')
  const fnvPrime = BigInt('0x100000001b3')
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i))
    h = (h * fnvPrime) & BigInt('0xffffffffffffffff')
  }
  return h.toString(16).padStart(16, '0')
}

/** previewHash：normalizedContent + mode + 标题 + 目标引用 */
export function computeMarkdownPreviewHash(params: {
  normalizedContent: string
  mode: MarkdownImportMode
  title: string | null
  parentId?: number | null
  targetDocumentId?: number | null
}): string {
  const payload = [
    params.normalizedContent,
    params.mode,
    params.title ?? '',
    params.parentId ?? '',
    params.targetDocumentId ?? '',
  ].join('|')
  return markdownFnv1aHash(payload)
}

/** sourceDocumentHash：文档身份 + normalized content + updatedAt（缺省用空串保证确定性） */
export function computeMarkdownSourceDocumentHash(params: {
  documentId: number | string
  content: string | null
  updatedAt?: string | null
}): string {
  const payload = [
    String(params.documentId),
    normalizeMarkdownText(params.content ?? ''),
    params.updatedAt ?? '',
  ].join('|')
  return markdownFnv1aHash(payload)
}

/** exportHash：文档身份 + contentHash + 安全标题 */
export function computeMarkdownExportHash(params: {
  documentId: number | string
  contentHash: string
  name: string
}): string {
  return markdownFnv1aHash([String(params.documentId), params.contentHash, params.name].join('|'))
}

/** bundleHash：确定性文档引用序列 + 各自 contentHash */
export function computeMarkdownBundleHash(params: {
  orderedRefs: string[]
  contentHashes: string[]
}): string {
  const refs = [...params.orderedRefs].sort()
  const hashes = [...params.contentHashes].sort()
  return markdownFnv1aHash([refs.join(','), hashes.join(',')].join('|'))
}

// ---------------------------------------------------------------------------
// 纯函数：manifest / 排序 / 脱敏
// ---------------------------------------------------------------------------

/** 确定性排序：路径字典序（稳定、可复现） */
export function sortMarkdownExportItems<T extends { path: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** 汇总 manifest（含失败/跳过/拒绝计数） */
export function summarizeMarkdownExportManifest(
  items: MarkdownExportTreeItem[],
): MarkdownExportBundleManifest {
  const exportedCount = items.filter((i) => i.status === 'exported').length
  const skippedCount = items.filter((i) => i.status === 'skipped').length
  const failedCount = items.filter((i) => i.status === 'failed').length
  const deniedCount = items.filter((i) => i.status === 'denied').length
  return {
    exportedCount,
    skippedCount,
    failedCount,
    deniedCount,
    items: sortMarkdownExportItems(items),
  }
}

/** 警告确定性排序：按码字典序（等价输入产出相同顺序） */
export function sortMarkdownWarnings(warnings: MarkdownWarning[]): MarkdownWarning[] {
  return [...warnings].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
}

/** 警告码去重顺序（保持码字典序） */
export function collectMarkdownWarningCodes(warnings: MarkdownWarning[]): MarkdownWarningCode[] {
  return [...new Set(sortMarkdownWarnings(warnings).map((w) => w.code))]
}

// ---------------------------------------------------------------------------
// 纯函数：审计 metadata（低敏）
// ---------------------------------------------------------------------------

const MARKDOWN_AUDIT_SENSITIVE_KEYS = [
  'content',
  'markdown',
  'normalizedContent',
  'fullText',
  'rawBody',
  'payload',
  'filePath',
  'absolutePath',
  'storagePath',
  'fileName',
  'title',
]

/** 审计 metadata 脱敏：绝不携带完整正文/文件名/路径 */
export function redactMarkdownAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const isSensitive = MARKDOWN_AUDIT_SENSITIVE_KEYS.some((sk) =>
      key.toLowerCase().includes(sk.toLowerCase()),
    )
    redacted[key] = isSensitive ? '[REDACTED]' : value
  }
  return redacted
}

/** 构建预览/确认审计 metadata（含哈希与计数，无正文） */
export function buildMarkdownAuditMetadata(params: {
  mode: MarkdownImportMode
  documentId?: number | string | null
  previewHash?: string | null
  sourceDocumentHash?: string | null
  byteCount?: number | null
  warningCodes?: MarkdownWarningCode[]
  status: 'preview' | 'confirmed' | 'validation_failed' | 'stale_blocked' | 'permission_denied'
}): Record<string, unknown> {
  return redactMarkdownAuditMetadata({
    mode: params.mode,
    documentId: params.documentId ?? null,
    previewHash: params.previewHash ?? null,
    sourceDocumentHash: params.sourceDocumentHash ?? null,
    byteCount: params.byteCount ?? null,
    warningCodes: params.warningCodes ?? [],
    status: params.status,
  })
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isMarkdownImportMode(value: unknown): value is MarkdownImportMode {
  return typeof value === 'string' && (MARKDOWN_IMPORT_MODES as readonly string[]).includes(value)
}

export function isMarkdownWarningCode(value: unknown): value is MarkdownWarningCode {
  return typeof value === 'string' && (MARKDOWN_WARNING_CODES as readonly string[]).includes(value)
}

export function isMarkdownAllowedAction(value: unknown): value is MarkdownAllowedAction {
  return (
    typeof value === 'string' && (MARKDOWN_ALLOWED_ACTIONS as readonly string[]).includes(value)
  )
}
