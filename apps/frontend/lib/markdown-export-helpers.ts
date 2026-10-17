'use client'

import type { ApiError } from '@/lib/api-client'
import type { MarkdownExportSingleResult, MarkdownExportTreeResult } from '@aiproj/types'

/**
 * 项目文档 Markdown 导出前端 helpers（v3-document-markdown-import-export §6.3）：
 * 下载/复制流程，保留安全文件名并统一归一化 API 错误。
 */

/** 触发浏览器下载：Blob URL + <a download>，完成后释放。 */
export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 从导出结果生成下载 Blob（UTF-8 BOM 便于中文编辑器识别）。 */
export function markdownExportToBlob(result: Pick<MarkdownExportSingleResult, 'content'>): Blob {
  return new Blob(['\uFEFF', result.content], { type: 'text/markdown;charset=utf-8' })
}

/** 安全文件名兜底：非法字符替换为下划线，超长截断并保留 .md 后缀。 */
export function safeExportFilename(filename: string, maxLength = 200): string {
  const base = filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
  const withoutExt = base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base
  const trimmed =
    withoutExt.length > maxLength - 3 ? withoutExt.slice(0, maxLength - 3) : withoutExt
  return `${trimmed}.md`
}

/** 单文档导出 → 下载文件。 */
export function downloadSingleExport(result: MarkdownExportSingleResult) {
  triggerBrowserDownload(markdownExportToBlob(result), safeExportFilename(result.filename))
}

/** 选中树导出 → 下载 bundle。 */
export function downloadTreeExport(result: MarkdownExportTreeResult) {
  triggerBrowserDownload(markdownExportToBlob(result), safeExportFilename(result.filename))
}

/** 复制导出内容到剪贴板（失败时抛出归一化错误）。 */
export async function copyExportContent(content: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    const err = new Error('当前浏览器不支持剪贴板') as Error & { code?: string }
    err.code = 'CLIPBOARD_UNAVAILABLE'
    throw err
  }
  try {
    await navigator.clipboard.writeText(content)
  } catch {
    const err = new Error('复制失败，请手动复制') as Error & { code?: string }
    err.code = 'CLIPBOARD_REJECTED'
    throw err
  }
}

/** 统一 API 错误提取：返回 { code, message, details? } 便于 UI 展示。 */
export function toMarkdownApiError(e: unknown): ApiError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const maybe = e as { code?: unknown; message?: unknown; details?: unknown; status?: unknown }
    return {
      status: typeof maybe.status === 'number' ? maybe.status : 0,
      code: typeof maybe.code === 'string' ? maybe.code : 'UNKNOWN',
      message: typeof maybe.message === 'string' ? maybe.message : '操作失败',
      details: maybe.details,
    }
  }
  return { status: 0, code: 'UNKNOWN', message: '操作失败' }
}
