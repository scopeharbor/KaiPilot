'use client'

import { useCallback, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { useCopyCode } from '@/hooks/use-copy-code'

/**
 * 项目文档 Markdown 阅读器（v3-document-code-block-support §4.1 + v3-document-formula-support §3.1）。
 *
 * 安全基线：
 * - react-markdown v9 默认不渲染 raw HTML（不引入 rehype-raw）
 * - rehype-highlight 以 detect:false 强制未标注语言纯文本渲染
 * - rehype-katex 以 strict:'error' + trust:false + throwOnError:false 安全渲染公式
 * - 自定义 img 组件不加载远程资源
 * - 自定义 pre/code 块级组件提供语言标签 + 复制按钮
 * - 不调用 AI、不发起外部网络请求
 */

export interface MarkdownDocumentViewerProps {
  content: string
  /** v3-document-code-block-support 多 change 间隙：codeBlocks prop 保留但在当前组件中未使用 */
  codeBlocks?: unknown[]
}

export function MarkdownDocumentViewer({ content }: MarkdownDocumentViewerProps) {
  const components: Components = {
    // 自定义图片：安全占位，不加载远程资源（§D4）
    img({ src, alt }: { src?: string | Blob; alt?: string }) {
      const displayAlt = alt || '图片'
      const srcStr = typeof src === 'string' ? src : ''
      return (
        <div
          className="my-3 flex items-center gap-2 rounded border border-dashed border-gray-300 px-3 py-2 dark:border-gray-600"
          data-testid="md-image-placeholder"
        >
          <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">
            🖼
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{displayAlt}</span>
          {srcStr && (
            <span className="truncate text-xs text-gray-400 dark:text-gray-500">
              （不外链加载）
            </span>
          )}
        </div>
      )
    },

    // 自定义 pre：外层容器（§D3）
    pre({ children, ...props }) {
      return (
        <pre
          className="code-block-container my-4 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900"
          data-testid="md-pre"
          {...props}
        >
          {children}
        </pre>
      )
    },

    // 自定义 code：区分行内 vs 块级（§D3）
    code({ className, children, ...props }) {
      if (!className) {
        // 行内代码
        return (
          <code
            className="rounded bg-gray-100 px-1 py-0.5 font-mono text-sm text-pink-700 dark:bg-gray-800 dark:text-pink-400"
            data-testid="md-inline-code"
            {...props}
          >
            {children}
          </code>
        )
      }

      // 块级代码：语言标签 + 复制按钮
      const langMatch = /language-(\S+)/.exec(className)
      // noUncheckedIndexedAccess 下捕获组是 string | undefined，归一到 null 以匹配 props 类型
      const language = langMatch?.[1] ?? null
      const codeText = extractTextFromChildren(children)

      return (
        <div data-testid="md-code-block">
          <CodeBlockHeader language={language} codeText={codeText} />
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      )
    },
  }

  return (
    <div
      className="markdown-document-viewer prose prose-sm max-w-none dark:prose-invert"
      data-density-aware
      data-testid="markdown-document-viewer"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              strict: 'error' as const,
              throwOnError: false,
              trust: false,
              output: 'htmlAndMathml' as const,
            },
          ],
          [
            rehypeHighlight,
            {
              detect: false,
              ignoreMissing: true,
              subset: false,
            },
          ],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** 代码块头部：语言标签 + 复制按钮（§D3） */
function CodeBlockHeader({ language, codeText }: { language: string | null; codeText: string }) {
  const { copied, copy, resetCopy } = useCopyCode()

  const handleCopy = useCallback(async () => {
    try {
      await copy(codeText)
    } catch {
      // 复制失败已有 hook 内反馈
    }
  }, [codeText, copy])

  const displayLang = language || '文本'

  return (
    <div
      className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5 dark:border-gray-700"
      data-testid="code-block-header"
    >
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{displayLang}</span>
      <button
        type="button"
        onClick={handleCopy}
        onBlur={() => {
          if (copied) setTimeout(resetCopy, 800)
        }}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
        data-testid="code-copy-button"
      >
        {copied ? (
          <>
            <CheckIcon className="h-3 w-3" />
            已复制
          </>
        ) : (
          <>
            <CopyIcon className="h-3 w-3" />
            复制
          </>
        )}
      </button>
    </div>
  )
}

/** 从 React children 提取原始文本 */
function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) {
    return children
      .map((child) => {
        if (typeof child === 'string') return child
        if (child && typeof child === 'object' && 'props' in child) {
          return extractTextFromChildren(
            (child as { props: { children?: ReactNode } }).props.children,
          )
        }
        return ''
      })
      .join('')
  }
  return ''
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
