// v3-document-code-block-support —— 项目文档 Markdown 阅读器与围栏代码块共享契约（前后端共用）。
// 覆盖：FencedCodeBlockMeta、DocumentContent DTO、语言白名单、复制结果类型。
// 设计约束：离线语法高亮、未标语言不猜测、纯文本降级、安全渲染（无 raw HTML 执行、无远程图片加载）。

// ---------------------------------------------------------------------------
// 语言白名单（highlight.js common 子集 + 文档高频语言）
// ---------------------------------------------------------------------------
export const SUPPORTED_CODE_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'css',
  'diff',
  'go',
  'ini',
  'java',
  'javascript',
  'json',
  'kotlin',
  'makefile',
  'markdown',
  'objectivec',
  'perl',
  'php',
  'python',
  'ruby',
  'rust',
  'scss',
  'shell',
  'sql',
  'toml',
  'typescript',
  'xml',
  'yaml',
] as const

export type SupportedCodeLanguage = (typeof SUPPORTED_CODE_LANGUAGES)[number]

export function isSupportedCodeLanguage(value: string): value is SupportedCodeLanguage {
  return (SUPPORTED_CODE_LANGUAGES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 围栏代码块元数据（后端提取用，前后端共享）
// ---------------------------------------------------------------------------
export interface FencedCodeBlockMeta {
  /** 语言标识（小写、从 info string 首个 token 提取），null = 未标注 */
  language: string | null
  /** 是否为支持高亮的语言 */
  labeled: boolean
  /** info string 首个 token 是否在 SUPPORTED_CODE_LANGUAGES 白名单内 */
  supported: boolean
  /** 围栏起始行号（1-based） */
  startLine: number
  /** 围栏结束行号（1-based），未闭合时指向文档末尾行 */
  endLine: number
  /** 代码内容行数（不含围栏行） */
  lineCount: number
  /** 代码内容字节数（UTF-8） */
  byteCount: number
  /** 围栏是否已闭合 */
  closed: boolean
}

// ---------------------------------------------------------------------------
// 文档正文响应 DTO
// ---------------------------------------------------------------------------
export interface DocumentContentResponse {
  id: number
  title: string
  documentType: 'document'
  content: string
  contentHash: string | null
  codeBlocks: FencedCodeBlockMeta[]
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// 复制结果
// ---------------------------------------------------------------------------
export const COPY_CODE_RESULTS = ['copied', 'failed', 'unavailable'] as const
export type CopyCodeResult = (typeof COPY_CODE_RESULTS)[number]

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------
export function isCopyCodeResult(value: string): value is CopyCodeResult {
  return (COPY_CODE_RESULTS as readonly string[]).includes(value)
}
