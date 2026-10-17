'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Copy,
  Menu,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HelpHeading } from '@/lib/help/types'

/**
 * 帮助文章新轨长文阅读器（v3-ui-next-help-knowledge-domain W1 · tasks 1.5，
 * spec「帮助文章详情与长文纸光排版阅读」）。
 *
 * - 视觉档位：方案 A 容器框架（暗夜底色 + 1px 发丝线）+ 方案 B「纸光编辑感」
 *   排版内核——黄金阅读宽度（max-w-3xl）、16px / 1.75 松弛行高、墨水金强调
 *   （既有令牌 `--nx-role-accent` #d97706，零臆造令牌）；
 * - 桌面端左侧 Sticky 导览树（当前文章高亮 aria-current）、移动端折叠目录、
 *   右侧 Headings 大纲（IntersectionObserver 动态高亮，缺省环境安全回退）；
 * - 顶部常驻「复制 Markdown 全文」与「复制为 Agent 提示词」工具出口
 *   （文本由 RSC 预计算传入，客户端零网络）；
 * - 正文内 `/help/…` 链接改写为 `/next/help/…`，保证深链留在新轨；
 * - 全部内容经 props 注入，无任何业务网络请求；登录全员可见、零 RBAC 判断。
 */

// ---------------------------------------------------------------------------
// 对外契约
// ---------------------------------------------------------------------------

/** 左侧导览树分组（导航顺序由页面侧按 nav.areas 构造）。 */
export interface HelpNavTreeGroup {
  areaId: string
  areaLabel: string
  articles: Array<{ id: string; title: string }>
}

/** 阅读器使用的文章投影（不含 roles/permissions 等未展示字段，props 轻量化）。 */
export interface HelpReaderArticle {
  id: string
  area: string
  title: string
  summary: string
  contentType: string
  contentStatus: 'skeleton' | 'complete'
  productVersion: string
  editions: string[]
  owner: string
  updatedAt: string
  reviewAfter: string
  related: string[]
  body: string
  headings: HelpHeading[]
}

export interface HelpArticleReaderProps {
  article: HelpReaderArticle
  /** 所属业务模块标签。 */
  areaLabel: string
  /** 左侧导览树数据。 */
  tree: HelpNavTreeGroup[]
  /** related 文章标题映射（页面侧已解析存在性）。 */
  relatedTitles: Record<string, string>
  /** 复制 Markdown 原文（RSC 预计算）。 */
  markdownText: string
  /** 复制为 Agent 提示词出口（agentExportMarkdown，RSC 预计算）。 */
  agentPromptText: string
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  'getting-started': '快速开始',
  concept: '概念',
  'how-to': '操作指南',
  tutorial: '教程',
  reference: '参考',
  troubleshooting: '故障排查',
  faq: 'FAQ',
  'release-notes': '版本说明',
  support: '支持',
}

/** 文章正文首行通常是与 frontmatter 同题的 H1（页头已展示标题），渲染时剥离避免重复。 */
function stripLeadingH1(body: string): string {
  return body.replace(/^#\s+[^\r\n]*(\r?\n)?/, '')
}

/** 从 React children 提取纯文本（标题锚点 id 解析用）。 */
export function readerTextOf(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map((child) => readerTextOf(child)).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return readerTextOf((children as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const success = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!success) throw new Error('execCommand 复制失败')
}

// ---------------------------------------------------------------------------
// 导览树（桌面 Sticky / 移动端折叠抽屉共用同一数据）
// ---------------------------------------------------------------------------

function HelpTreeNav({ tree, currentId }: { tree: HelpNavTreeGroup[]; currentId: string }) {
  return (
    <nav aria-label="帮助文档目录" data-testid="next-help-nav-tree" className="flex flex-col gap-4">
      <Link
        href="/next/help"
        data-testid="next-help-nav-home"
        className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-accent)]"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        帮助首页
      </Link>
      {tree.map((group) => (
        <div key={group.areaId} data-testid={`next-help-nav-group-${group.areaId}`}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
            {group.areaLabel}
          </h3>
          <ul className="space-y-0.5 border-l border-[var(--nx-border-hairline)] pl-3">
            {group.articles.map((entry) => {
              const active = entry.id === currentId
              return (
                <li key={entry.id}>
                  <Link
                    href={`/next/help/articles/${encodeURIComponent(entry.id)}`}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`next-help-nav-article-${entry.id}`}
                    className={cn(
                      '-ml-px block border-l py-1 pl-3 text-xs leading-5',
                      active
                        ? 'border-l-[var(--nx-accent)] font-medium text-[var(--nx-accent)]'
                        : 'border-l-transparent text-[var(--nx-text-secondary)] hover:border-l-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
                    )}
                  >
                    {entry.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// 正文 Markdown 渲染器（nx 令牌映射，方案 B 纸光排版内核）
// ---------------------------------------------------------------------------

function HelpProseRenderer({
  content,
  area,
  headings,
}: {
  content: string
  area: string
  headings: HelpHeading[]
}) {
  /** heading 文本 → 锚点 id（与 lib/help/load.ts extractHeadings 同规则）。 */
  const headingIds = new Map<string, string>()
  for (const heading of headings) {
    if (!headingIds.has(heading.text)) headingIds.set(heading.text, heading.id)
  }
  const headingIdOf = (children: ReactNode): string | undefined => {
    const text = readerTextOf(children)
    return headingIds.get(text)
  }

  const components: Components = {
    a({ href, children }) {
      if (!href) return <span>{children}</span>
      const className =
        'text-[var(--nx-accent)] underline underline-offset-4 hover:text-[var(--nx-space-cyan)]'
      if (href.startsWith('#') || href.startsWith('/api/')) return <a href={href}>{children}</a>
      if (href.startsWith('/')) {
        const nextHref = href.startsWith('/help/') ? href.replace(/^\/help\//, '/next/help/') : href
        return (
          <Link href={nextHref} className={className}>
            {children}
          </Link>
        )
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className}>
          {children}
        </a>
      )
    },
    img({ src, alt }) {
      const finalSrc =
        typeof src === 'string' && src
          ? src.startsWith('http') || src.startsWith('/api/help/')
            ? src
            : `/api/help/assets/${area}/${src.replace(/^\.\//, '')}`
          : ''
      return (
        <img
          src={finalSrc}
          alt={typeof alt === 'string' && alt ? alt : '帮助中心配图'}
          loading="lazy"
          className="my-5 h-auto max-w-full rounded-md border border-[var(--nx-border-hairline)]"
        />
      )
    },
    h2({ children, id }) {
      return (
        <h2
          id={id ?? headingIdOf(children)}
          className="mb-3 mt-8 scroll-mt-24 border-b border-[var(--nx-border-hairline)] pb-2 text-xl font-semibold text-[var(--nx-role-accent)]"
        >
          {children}
        </h2>
      )
    },
    h3({ children, id }) {
      return (
        <h3
          id={id ?? headingIdOf(children)}
          className="mb-2 mt-6 scroll-mt-24 text-base font-semibold text-[var(--nx-role-accent)]"
        >
          {children}
        </h3>
      )
    },
    h4({ children, id }) {
      return (
        <h4
          id={id ?? headingIdOf(children)}
          className="mb-2 mt-5 scroll-mt-24 text-sm font-semibold"
        >
          {children}
        </h4>
      )
    },
    p({ children }) {
      return (
        <p className="my-4 text-base leading-[1.75] text-[var(--nx-text-primary)]">{children}</p>
      )
    },
    ul({ children }) {
      return <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>
    },
    ol({ children }) {
      return <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>
    },
    li({ children }) {
      return <li className="leading-[1.75] text-[var(--nx-text-primary)]">{children}</li>
    },
    blockquote({ children }) {
      return (
        <blockquote className="my-5 border-l-2 border-[var(--nx-role-accent)] bg-[rgba(217,119,6,0.07)] py-2 pl-4 pr-3 text-[var(--nx-text-secondary)]">
          {children}
        </blockquote>
      )
    },
    pre({ children }) {
      return (
        <pre className="my-5 overflow-x-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] p-4 text-sm leading-6">
          {children}
        </pre>
      )
    },
    code({ className: cls, children, ...props }) {
      if (!cls) {
        return (
          <code
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--nx-accent)]"
            {...props}
          >
            {children}
          </code>
        )
      }
      return (
        <code className={cn('font-mono text-[0.9em]', cls)} {...props}>
          {children}
        </code>
      )
    },
    table({ children }) {
      return (
        <div className="my-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      )
    },
    th({ children }) {
      return (
        <th className="border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-left font-medium text-[var(--nx-text-secondary)]">
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td className="border border-[var(--nx-border-hairline)] px-3 py-2 align-top leading-[1.75] text-[var(--nx-text-primary)]">
          {children}
        </td>
      )
    },
    hr() {
      return <hr className="my-6 border-[var(--nx-border-hairline)]" />
    },
  }

  return (
    <div data-testid="next-help-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true, subset: false }]]}
        allowedElements={[
          'p',
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
        ]}
        unwrapDisallowed
        components={components}
      >
        {stripLeadingH1(content)}
      </ReactMarkdown>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 阅读器主组件
// ---------------------------------------------------------------------------

export function HelpArticleReader({
  article,
  areaLabel,
  tree,
  relatedTitles,
  markdownText,
  agentPromptText,
}: HelpArticleReaderProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'markdown' | 'agent'>('idle')
  const [copyError, setCopyError] = useState<string | null>(null)
  const [activeToc, setActiveToc] = useState<string | null>(null)
  const feedbackTimer = useRef<number | null>(null)

  const toc = useMemo(
    () => article.headings.filter((h) => h.level >= 2 && h.level <= 3),
    [article.headings],
  )

  /** 复制出口（RL-01：写剪贴板纯客户端动作，零网络）。 */
  const runCopy = useCallback(
    async (kind: 'markdown' | 'agent') => {
      setCopyError(null)
      try {
        await writeClipboardText(kind === 'markdown' ? markdownText : agentPromptText)
        setCopyState(kind)
        if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
        feedbackTimer.current = window.setTimeout(() => setCopyState('idle'), 2000)
      } catch {
        setCopyState('idle')
        setCopyError('复制失败：当前浏览器环境不支持剪贴板写入，请手动选择复制。')
      }
    },
    [markdownText, agentPromptText],
  )

  useEffect(() => {
    return () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    }
  }, [])

  /** 右侧大纲动态高亮：IntersectionObserver 不可用（旧环境/测试）时安全回退首条目。 */
  useEffect(() => {
    if (toc.length === 0) return
    if (typeof IntersectionObserver === 'undefined') {
      setActiveToc(toc[0]!.id)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const first = visible[0]
        if (first?.target.id) setActiveToc(first.target.id)
      },
      { rootMargin: '-15% 0px -70% 0px' },
    )
    for (const heading of toc) {
      const element = document.getElementById(heading.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [toc])

  const relatedEntries = article.related
    .map((id) => ({ id, title: relatedTitles[id] }))
    .filter((entry) => typeof entry.title === 'string' && entry.title.length > 0)

  return (
    <div data-testid="next-help-article" className="mx-auto w-full max-w-6xl">
      {/* 移动端折叠目录 */}
      <div className="mb-4 lg:hidden">
        <button
          type="button"
          aria-expanded={mobileNavOpen}
          aria-controls="next-help-mobile-nav-panel"
          aria-label="打开文档目录"
          data-testid="next-help-mobile-nav-toggle"
          onClick={() => setMobileNavOpen((open) => !open)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <Menu className="h-3.5 w-3.5" aria-hidden />
          文档目录
        </button>
        {mobileNavOpen && (
          <div
            id="next-help-mobile-nav-panel"
            data-testid="next-help-mobile-nav-panel"
            className="mt-2 max-h-[70vh] overflow-y-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
          >
            <HelpTreeNav tree={tree} currentId={article.id} />
          </div>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* 桌面 Sticky 导览树 */}
        <aside className="hidden lg:block" data-testid="next-help-desktop-nav">
          <div className="sticky top-24 max-h-[calc(100vh-7.5rem)] overflow-y-auto pr-2">
            <HelpTreeNav tree={tree} currentId={article.id} />
          </div>
        </aside>

        <main className="min-w-0">
          {/* 头部：标题 / 摘要 / 元信息 / 工具出口 */}
          <header className="flex flex-col gap-3">
            <nav
              aria-label="面包屑"
              className="flex flex-wrap items-center gap-1 text-xs text-[var(--nx-text-muted)]"
              data-testid="next-help-breadcrumbs"
            >
              <Link href="/next/help" className="hover:text-[var(--nx-text-primary)]">
                帮助中心
              </Link>
              <span aria-hidden>/</span>
              <span>{areaLabel}</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--nx-text-primary)]">
                {article.title}
              </h1>
              <span className="inline-flex items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]">
                {CONTENT_TYPE_LABELS[article.contentType] ?? article.contentType}
              </span>
              {article.contentStatus === 'skeleton' && (
                <span
                  data-testid="next-help-skeleton-badge"
                  className="inline-flex items-center rounded-sm border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/10 px-2 py-0.5 font-mono text-[10px] text-[var(--nx-status-warning)]"
                >
                  内容完善中
                </span>
              )}
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-[var(--nx-text-muted)]">
              {article.summary}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--nx-text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                更新于 {article.updatedAt}（复核 {article.reviewAfter}）
              </span>
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" aria-hidden />
                责任人 {article.owner}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                版本 {article.productVersion} · 套餐 {article.editions.join('/')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="next-help-copy-bar">
              <button
                type="button"
                onClick={() => void runCopy('markdown')}
                data-testid="next-help-copy-markdown"
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                {copyState === 'markdown' ? (
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-[var(--nx-status-success)]"
                    aria-hidden
                  />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
                {copyState === 'markdown' ? '已复制 Markdown' : '复制 Markdown 全文'}
              </button>
              <button
                type="button"
                onClick={() => void runCopy('agent')}
                data-testid="next-help-copy-agent"
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-role-accent)]"
              >
                {copyState === 'agent' ? (
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-[var(--nx-status-success)]"
                    aria-hidden
                  />
                ) : (
                  <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
                )}
                {copyState === 'agent' ? '已复制 Agent 提示词' : '复制为 Agent 提示词'}
              </button>
            </div>
            {copyError && (
              <p
                role="alert"
                data-testid="next-help-copy-error"
                className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[var(--nx-status-danger)]/10 px-3 py-1.5 text-xs text-[var(--nx-status-danger)]"
              >
                {copyError}
              </p>
            )}
          </header>

          {/* 正文（方案 B 纸光内核）+ 右侧大纲 */}
          <div className="mt-6 grid gap-10 xl:grid-cols-[minmax(0,1fr)_200px]">
            <article
              data-testid="next-help-article-body"
              className="max-w-3xl min-w-0 scroll-mt-24"
            >
              <HelpProseRenderer
                content={article.body}
                area={article.area}
                headings={article.headings}
              />
            </article>

            {toc.length > 0 && (
              <aside className="hidden xl:block" data-testid="next-help-toc">
                <nav aria-label="本页目录" className="sticky top-24 space-y-1">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                    本页目录
                  </p>
                  {toc.map((heading) => {
                    const active = heading.id === activeToc
                    return (
                      <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        aria-current={active ? 'location' : undefined}
                        data-testid={`next-help-toc-${heading.id}`}
                        className={cn(
                          'block border-l py-0.5 text-xs leading-5',
                          active
                            ? 'border-l-[var(--nx-accent)] font-medium text-[var(--nx-accent)]'
                            : 'border-l-transparent text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]',
                        )}
                        style={{ paddingLeft: `${(heading.level - 2) * 0.75 + 0.75}rem` }}
                      >
                        {heading.text}
                      </a>
                    )
                  })}
                </nav>
              </aside>
            )}
          </div>

          {/* 相关文章 */}
          {relatedEntries.length > 0 && (
            <section
              aria-label="相关文章"
              data-testid="next-help-related"
              className="mt-10 border-t border-[var(--nx-border-hairline)] pt-6"
            >
              <h2 className="mb-3 text-sm font-semibold text-[var(--nx-text-secondary)]">
                相关文章
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {relatedEntries.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={`/next/help/articles/${encodeURIComponent(entry.id)}`}
                      data-testid={`next-help-related-${entry.id}`}
                      className="block rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                    >
                      {entry.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 底部元信息 */}
          <footer
            className="mt-8 flex flex-wrap items-center gap-4 border-t border-[var(--nx-border-hairline)] pt-4 text-xs text-[var(--nx-text-muted)]"
            data-testid="next-help-meta"
          >
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3" aria-hidden />
              本文档随产品发布，内容由平台团队维护
            </span>
            <Link href="/next/help" className="ml-auto hover:text-[var(--nx-accent)]">
              返回帮助中心
            </Link>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default HelpArticleReader
