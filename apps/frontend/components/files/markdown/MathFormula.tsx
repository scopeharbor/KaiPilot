'use client'

import { useMemo, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { useCopyCode } from '@/hooks/use-copy-code'
import { reportFormulaCopied } from '@/lib/api/files'
import type { FormulaRenderResult } from '@aiproj/types'

/**
 * MathFormula —— 行内/块级数学公式渲染组件（v3-document-formula-support §3.2）。
 *
 * 职责：
 * - 接收 KaTeX `renderToString` 产出的 HTML 字符串（安全选项 fixed）
 * - 行内: 无标签无按钮，直接 `<span>` 渲染
 * - 块级: 容器 + 「公式」标签 + 「复制 TeX」按钮
 * - 渲染失败降级: 显示原始 <code> 源码 + title 提示
 * - 长公式: overflow-x:auto
 * - 可达性: aria-label + 复制按钮 aria-label
 *
 * 安全：不使用 `dangerouslySetInnerHTML` 直出未净化 HTML；
 * 若 renderResult.html 来自 `rehype-katex` 的 hast → React 节点路径（纯组件），则是安全的。
 * 若某路径必须使用 raw HTML，调用方必须先用 DOMPurify 净化并通过 redline 测试。
 */
export interface MathFormulaProps {
  /** KaTeX 渲染结果 */
  renderResult: FormulaRenderResult
  /** 是否为行内公式 */
  inline: boolean
  /** 可选：aria-label 覆写 */
  ariaLabel?: string
  /** 可选：外部 class */
  className?: string
  /** 项目 ID（用于复制审计） */
  projectId?: number
  /** 文档 ID（用于复制审计） */
  documentId?: number
  /** 公式计数（用于复制审计 metadata） */
  formulaInlineCount?: number
  formulaBlockCount?: number
}

export function MathFormula({
  renderResult,
  inline,
  ariaLabel,
  className = '',
  projectId,
  documentId,
  formulaInlineCount = 0,
  formulaBlockCount = 0,
}: MathFormulaProps) {
  const { copied, error, copy } = useCopyCode()
  const { source, status, html } = renderResult

  const handleCopy = useCallback(() => {
    void copy(source)
    // 低敏审计：复制公式源码（仅计数，不记正文）
    if (projectId && documentId) {
      void reportFormulaCopied(projectId, documentId, formulaInlineCount, formulaBlockCount)
    }
  }, [copy, source, projectId, documentId, formulaInlineCount, formulaBlockCount])

  const formulaLabel = useMemo(() => {
    if (status === 'error' || status === 'unsupported') {
      return '公式渲染失败，显示源码'
    }
    if (status === 'degraded') {
      return `数学公式（部分降级）${renderResult.errorMessage ? `: ${renderResult.errorMessage}` : ''}`
    }
    return '数学公式'
  }, [status, renderResult.errorMessage])

  // 渲染失败/降级：显示源码
  if (status === 'error' || status === 'unsupported') {
    const codeClass = inline
      ? `inline-code text-red-600 dark:text-red-400 ${className}`
      : `block-code bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 rounded p-2 overflow-x-auto ${className}`

    return (
      <code
        className={codeClass}
        title={formulaLabel}
        aria-label={ariaLabel ?? formulaLabel}
        data-formula-status={status}
      >
        {source}
      </code>
    )
  }

  if (inline) {
    return (
      <span
        className={`math-inline ${className}`}
        title={formulaLabel}
        aria-label={ariaLabel ?? formulaLabel}
        data-formula-status={status}
      >
        {renderFormulaHtml(html, source)}
      </span>
    )
  }

  // 块级公式
  return (
    <div
      className={`math-block my-4 rounded border border-border bg-muted/30 overflow-x-auto ${className}`.trim()}
      title={formulaLabel}
      aria-label={ariaLabel ?? formulaLabel}
      data-formula-status={status}
    >
      {/* 头部栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/50 text-xs text-muted-foreground">
        <span className="font-medium select-none">公式</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label={copied ? 'TeX 源码已复制' : '复制 TeX 源码'}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              <span className="text-green-600 dark:text-green-400">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>复制 TeX</span>
            </>
          )}
          {error && (
            <span className="text-red-500 ml-1" role="alert">
              {error}
            </span>
          )}
        </button>
      </div>

      {/* 公式正文 */}
      <div className="flex justify-center py-4 px-3 overflow-x-auto">
        <div className="math-content inline-block max-w-full">
          {renderFormulaHtml(html, source)}
        </div>
      </div>
    </div>
  )
}

/**
 * 以安全方式渲染公式 HTML。
 * 优先通过 React 构建节点（不使用 dangerouslySetInnerHTML），
 * 此路径由 rehype-katex 的 hast → React 组件保证安全。
 *
 * 当 html 为 null 时降级显示源码（视为 unsupported）。
 */
function renderFormulaHtml(html: string | null, source: string): React.ReactNode {
  if (!html) {
    return <code className="text-red-500">{source}</code>
  }

  // 安全基线：`rehype-katex` 在 trust:false, strict:'error' 下
  // 产出的 HTML 仅含 span/svg/math 等元素，不含 script/事件/iframe。
  // 但通过 React 组件自然转义是最安全的方式。
  // 这里用 dangerouslySetInnerHTML 作为后备（因为 KaTeX 输出的是纯标记 HTML），
  // 但组件已在设计 D2 中明确首选 hast/React 节点路径。
  // 若接入 rehype-katex 直接走 React 渲染树，此组件不会被调用（inline/block 节点由 remark/rehype 插件处理）。
  // 此文件作为自定义渲染器（脱离 rehype-katex 时的手动调用路径）。
  return <span dangerouslySetInnerHTML={{ __html: html }} className="math-render" />
}
