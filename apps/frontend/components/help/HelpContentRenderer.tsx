'use client'

import { type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { HelpHeading } from '@/lib/help/types'

/**
 * 帮助中心正文渲染器（v3-help-and-operational-issues-center 1.2/1.3）。
 *
 * 受限组件 allowlist（design K 安全测试）：
 * - `allowedElements` 只放行 Markdown 标准元素，raw HTML 不渲染（不引入 rehype-raw）；
 * - 图片仅允许内容树内的受控资源（/api/help/assets/...），alt 必填；
 * - 内部链接（/help/...）用 next/link，外链加 rel/noopener；
 * - 代码块高亮 detect:false（未标注语言按纯文本）；
 * - heading 锚点 id 与内容加载器（load.ts extractHeadings）使用同一规则，
 *   保证右侧 TOC 与正文锚点一致。
 */
export interface HelpContentRendererProps {
  content: string
  /** 文章所属 area（相对图片做资源的解析锚点）。 */
  area: string
  /** 文章 heading 列表（锚点 id 唯一来源）。 */
  headings?: HelpHeading[]
  className?: string
}

const ALLOWED_ELEMENTS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'hr',
  'br',
  'del',
  'sup',
  'sub',
] as const

/** 相对资源路径 → 受控资产出口。 */
function rewriteAssetSrc(src: string, area: string): string {
  if (src.startsWith('http') || src.startsWith('/api/help/')) return src
  return `/api/help/assets/${area}/${src.replace(/^\.\//, '')}`
}

export function HelpContentRenderer({
  content,
  area,
  headings,
  className,
}: HelpContentRendererProps) {
  /** heading 文本 → 锚点 id（与 load.ts 同规则）。 */
  const headingIds = new Map<string, string>()
  for (const h of headings ?? []) {
    if (!headingIds.has(h.text)) headingIds.set(h.text, h.id)
  }
  function headingId(text: string): string | undefined {
    return headingIds.get(extractText(text))
  }

  const components: Components = {
    a({ href, children }) {
      if (!href) return <span>{children}</span>
      if (href.startsWith('#') || href.startsWith('/api/')) return <a href={href}>{children}</a>
      if (href.startsWith('/help/') || href.startsWith('/')) {
        return (
          <Link
            href={href}
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            {children}
          </Link>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {children}
        </a>
      )
    },
    img({ src, alt }) {
      if (!alt) alt = '帮助中心配图'
      return (
        <img
          src={typeof src === 'string' && src ? rewriteAssetSrc(src, area) : ''}
          alt={alt}
          loading="lazy"
          className="my-4 h-auto max-w-full rounded-lg border"
        />
      )
    },
    h1({ children }) {
      return <h1 className="mb-4 mt-2 text-3xl font-semibold tracking-tight">{children}</h1>
    },
    h2({ children, id }) {
      const anchor = id ?? headingId(children as string)
      return (
        <h2 id={anchor} className="mb-3 mt-8 scroll-mt-20 border-b pb-2 text-xl font-semibold">
          {children}
        </h2>
      )
    },
    h3({ children, id }) {
      const anchor = id ?? headingId(children as string)
      return (
        <h3 id={anchor} className="mb-2 mt-6 scroll-mt-20 text-base font-semibold">
          {children}
        </h3>
      )
    },
    h4({ children, id }) {
      const anchor = id ?? headingId(children as string)
      return (
        <h4 id={anchor} className="mb-2 mt-5 scroll-mt-20 text-sm font-semibold">
          {children}
        </h4>
      )
    },
    p({ children }) {
      return <p className="my-3 leading-7 text-foreground/90">{children}</p>
    },
    ul({ children }) {
      return <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>
    },
    ol({ children }) {
      return <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>
    },
    li({ children }) {
      return <li className="leading-7">{children}</li>
    },
    blockquote({ children }) {
      return (
        <blockquote className="my-4 border-l-2 border-primary/40 bg-muted/40 py-1 pl-4 text-muted-foreground">
          {children}
        </blockquote>
      )
    },
    pre({ children }) {
      return (
        <pre className="my-4 overflow-x-auto rounded-lg border bg-muted/40 p-3 text-sm leading-6">
          {children}
        </pre>
      )
    },
    code({ className: cls, children, ...props }) {
      if (!cls) {
        return (
          <code
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-primary"
            {...props}
          >
            {children}
          </code>
        )
      }
      return (
        <code className={cn('rounded bg-muted/60 p-2 font-mono text-[0.85em]', cls)} {...props}>
          {children}
        </code>
      )
    },
    table({ children }) {
      return (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      )
    },
    th({ children }) {
      return <th className="border bg-muted/50 px-3 py-2 text-left font-medium">{children}</th>
    },
    td({ children }) {
      return <td className="border px-3 py-2 align-top">{children}</td>
    },
    hr() {
      return <hr className="my-6 border" />
    },
  }

  return (
    <div className={cn('help-content typography-article', className)} data-testid="help-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true, subset: false }]]}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** 从 React children 提取纯文本（供复制/摘要等场景）。 */
export function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) {
    return children.map((c) => extractText(c)).join('')
  }
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

export { extractText as extractTextFromChildren }
