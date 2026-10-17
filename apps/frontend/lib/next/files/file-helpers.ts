import {
  Archive,
  Code2,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
  type LucideIcon,
} from 'lucide-react'

/**
 * 文件域纯函数工具与类型映射（v3-ui-next-resource-team-domains W3 · tasks 3.1，
 * design §4.1「类型语义图标与颜色映射」）。
 *
 * - MIME / 后缀 → 语义图标 + 主题色描述符（PDF 红 / Word 蓝 / Excel 翠绿 /
 *   PPT 橙 / 图片紫 / 压缩包琥珀 / 代码青 / 通用冷灰）；
 * - 可读文件大小格式化（B / KB / MB / GB，一位小数）；
 * - 单文件 10MB 上限 + 扩展名白名单与空文件前端预检（零网络外发，RL-06）。
 *
 * 全部为纯函数/常量，无 DOM 依赖；图标以 lucide 组件引用直出，保证底册渲染
 * 与测试断言同源一致。
 */

/** 单文件大小上限：10MB（对齐既有服务端契约，见 project_attachments_controller `size: '10mb'`）。 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** 单文件大小上限的人类可读文案（用于预检错误与 UI 提示）。 */
export const MAX_FILE_SIZE_LABEL = '10MB'

/** 上传扩展名白名单：与既有服务端契约 extnames（project_attachments_controller）逐项对齐。 */
export const ALLOWED_UPLOAD_EXTENSIONS: ReadonlyArray<string> = [
  'pdf',
  'md',
  'txt',
  'csv',
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'webp',
]

/** 上传扩展名白名单的人类可读文案（预检错误与 UI 提示同源共用）。 */
export const ALLOWED_UPLOAD_EXTENSIONS_LABEL = ALLOWED_UPLOAD_EXTENSIONS.join(' / ')

/** 附件类型大类（列表 Tab 收敛维度，design §4.1：全部/文档/表格/图片/压缩包）。 */
export type FileKindCategory = 'document' | 'sheet' | 'image' | 'archive'

/** 语义文件类型（图标/配色维度）。 */
export type FileKind = 'pdf' | 'word' | 'sheet' | 'slide' | 'image' | 'archive' | 'code' | 'generic'

/** 大类 Tab 契约。 */
export interface FileCategoryTab {
  id: 'all' | FileKindCategory
  label: string
}

/** 附件大类 Tab 白名单（全部/文档/表格/图片/压缩包）。 */
export const FILE_CATEGORY_TABS: ReadonlyArray<FileCategoryTab> = [
  { id: 'all', label: '全部' },
  { id: 'document', label: '文档' },
  { id: 'sheet', label: '表格' },
  { id: 'image', label: '图片' },
  { id: 'archive', label: '压缩包' },
]

/** MIME → 语义类型视觉描述符。 */
export interface FileKindVisual {
  kind: FileKind
  label: string
  color: string
  icon: LucideIcon
}

const KIND_VISUALS: Record<FileKind, FileKindVisual> = {
  pdf: { kind: 'pdf', label: 'PDF 文档', color: '#f87171', icon: FileText },
  word: { kind: 'word', label: 'Word 文档', color: '#60a5fa', icon: FileText },
  sheet: { kind: 'sheet', label: '表格', color: '#4ade80', icon: FileSpreadsheet },
  slide: { kind: 'slide', label: '演示文稿', color: '#fb923c', icon: Presentation },
  image: { kind: 'image', label: '图片', color: '#c084fc', icon: ImageIcon },
  archive: { kind: 'archive', label: '压缩包', color: '#fbbf24', icon: Archive },
  code: { kind: 'code', label: '代码/脚本', color: '#22d3ee', icon: Code2 },
  generic: { kind: 'generic', label: '通用文档', color: '#94a3b8', icon: File },
}

const DOCUMENT_KINDS: ReadonlySet<FileKind> = new Set(['pdf', 'word', 'slide', 'code', 'generic'])

/** 语义类型 → 大类（列表 Tab 收敛维度）。 */
export function fileKindCategoryOf(kind: FileKind): FileKindCategory {
  if (DOCUMENT_KINDS.has(kind)) return 'document'
  // 集合排除文档系后，剩余分支（sheet/image/archive）本身就是大类 ID。
  return kind as FileKindCategory
}

const SHEET_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
])

const SLIDE_MIMES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
])

const WORD_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'text/rtf',
  'application/rtf',
])

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-bzip2',
  'application/x-xz',
])

const CODE_MIMES = new Set([
  'application/json',
  'application/javascript',
  'text/javascript',
  'application/xml',
  'text/xml',
  'text/html',
  'application/xhtml+xml',
  'text/css',
  'application/typescript',
  'text/typescript',
  'text/x-typescript',
  'text/x-python',
  'application/x-python-code',
  'text/x-java-source',
  'text/x-csrc',
  'text/x-c++src',
  'text/x-sh',
  'application/x-sh',
  'text/x-shellscript',
  'text/yaml',
  'application/yaml',
  'application/x-yaml',
  'text/x-yaml',
  'application/sql',
  'text/x-sql',
])

/** MIME → 语义类型；未识别返回 null（交由后缀名兜底）。 */
export function fileKindOfMime(mimeType: string | null | undefined): FileKind | null {
  const mime = mimeType?.trim().toLowerCase()
  if (!mime) return null
  if (mime === 'application/pdf') return 'pdf'
  if (WORD_MIMES.has(mime)) return 'word'
  if (SHEET_MIMES.has(mime)) return 'sheet'
  if (SLIDE_MIMES.has(mime)) return 'slide'
  if (mime.startsWith('image/')) return 'image'
  if (ARCHIVE_MIMES.has(mime)) return 'archive'
  if (CODE_MIMES.has(mime)) return 'code'
  return null
}

/** 后缀名 → 语义类型（MIME 缺失/未识别时的兜底）。 */
export function fileKindOfFileName(fileName: string | null | undefined): FileKind | null {
  const name = fileName?.trim()
  if (!name) return null
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'doc':
    case 'docx':
    case 'odt':
    case 'rtf':
      return 'word'
    case 'xls':
    case 'xlsx':
    case 'ods':
    case 'csv':
      return 'sheet'
    case 'ppt':
    case 'pptx':
    case 'odp':
      return 'slide'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
    case 'ico':
    case 'heic':
    case 'avif':
      return 'image'
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'tgz':
    case 'bz2':
    case 'xz':
      return 'archive'
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'json':
    case 'css':
    case 'html':
    case 'htm':
    case 'xml':
    case 'yaml':
    case 'yml':
    case 'sh':
    case 'bash':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'cs':
    case 'go':
    case 'rs':
    case 'php':
    case 'rb':
    case 'sql':
    case 'toml':
    case 'ini':
      return 'code'
    default:
      return null
  }
}

/**
 * 附件 → 语义类型视觉描述符。优先 MIME，未识别/缺失时按文件名后缀兜底，
 * 两者都无法识别回退通用冷灰文档。
 */
export function fileVisualOf(
  mimeType: string | null | undefined,
  fileName?: string | null,
): FileKindVisual {
  const kind = fileKindOfMime(mimeType) ?? fileKindOfFileName(fileName)
  return KIND_VISUALS[kind ?? 'generic']
}

/** 可读文件大小（B / KB / MB / GB，一位小数）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 上传时间本地化格式化（YYYY-MM-DD HH:mm）。非法输入返回占位符。 */
export function formatFileTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** 上传预检失败码。 */
export type UploadValidationCode = 'FILE_TOO_LARGE' | 'FILE_EMPTY' | 'FILE_TYPE_NOT_ALLOWED'

/** 上传预检失败描述。 */
export interface UploadValidationError {
  ok: false
  code: UploadValidationCode
  message: string
}

/** 上传预检通过。 */
export interface UploadValidationSuccess {
  ok: true
}

export type UploadValidationResult = UploadValidationError | UploadValidationSuccess

/** 从文件名提取小写扩展名；无扩展名返回 null。 */
function fileExtensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return null
  return fileName.slice(dot + 1).toLowerCase()
}

/**
 * 单文件规格预检：10MB 上限 + 扩展名白名单 + 空文件（0 字节）拦截，上限与白名单
 * 对齐既有服务端上传契约（`size: '10mb'` + extnames，见 project_attachments_controller）。
 * 纯客户端阻断，返回失败时调用方必须零网络外发（RL-06）。
 */
export function validateUploadFile(file: Pick<File, 'name' | 'size'>): UploadValidationResult {
  if (file.size <= 0) {
    return { ok: false, code: 'FILE_EMPTY', message: '不能上传 0 字节空文件' }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `文件超出单文件 ${MAX_FILE_SIZE_LABEL} 限制`,
    }
  }
  const extension = fileExtensionOf(file.name)
  if (!extension || !ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: `不支持该文件格式，仅支持 ${ALLOWED_UPLOAD_EXTENSIONS_LABEL}`,
    }
  }
  return { ok: true }
}
