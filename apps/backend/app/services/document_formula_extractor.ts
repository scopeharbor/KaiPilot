/**
 * 项目文档公式元数据确定性提取器（v3-document-formula-support §2.1）。
 *
 * 纯函数，无副作用：接受 markdown 字符串，返回 FormulaExtractionResult。
 * 不改变归一化、不写回 content、不触碰 source/preview 哈希。
 * 导入归一化/哈希操作继续由 DocumentMarkdownImportExportService 管理。
 *
 * 定界逻辑使用与 @aiproj/types 同构的纯函数 extractFormulaDelimiters，
 * 保证前后端「所见即所计」。
 */

import { extractFormulaDelimiters, type FormulaExtractionResult } from '@aiproj/types'

/**
 * 从 Markdown 文本中提取公式元数据（包装共享契约纯函数）。
 *
 * @param content - 已验证的非空文档正文（假定由调用方做空值/权限检查）
 * @returns 确定性提取结果；输入为空时返回全零值
 */
export function extractDocumentFormulaMeta(content: string): FormulaExtractionResult {
  if (!content || content.trim().length === 0) {
    return {
      inlineCount: 0,
      blockCount: 0,
      totalBytes: 0,
      unsupportedCommandHits: [],
      delimiters: [],
    }
  }
  return extractFormulaDelimiters(content)
}

/**
 * 不计入 source/preview 哈希的轻量统计摘要。
 * 供只读审计路径使用。
 */
export function summarizeFormulaMeta(meta: FormulaExtractionResult): {
  inlineCount: number
  blockCount: number
  totalBytes: number
  hasUnsupported: boolean
} {
  return {
    inlineCount: meta.inlineCount,
    blockCount: meta.blockCount,
    totalBytes: meta.totalBytes,
    hasUnsupported: meta.unsupportedCommandHits.length > 0,
  }
}
