'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import {
  Copy,
  Link2,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  User,
  Flag,
} from 'lucide-react'
import { useCopyCode } from '@/hooks/use-copy-code'
import { fetchArticleMarkdown } from '@/lib/help/client'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import { HelpContentRenderer } from './HelpContentRenderer'
import type { HelpHeading } from '@/lib/help/types'

export interface HelpArticleViewArticle {
  id: string
  area: string
  title: string
  summary: string
  contentType: string
  roles: string[]
  editions: string[]
  productVersion: string
  featureFlags: string[]
  owner: string
  updatedAt: string
  reviewAfter: string
  related: string[]
  screenshots: string[]
  contentStatus: 'skeleton' | 'complete'
  body: string
  headings: HelpHeading[]
}

export interface HelpArticleViewProps {
  article: HelpArticleViewArticle
  areaLabel: string
  /** related 文章标题映射（服务端已解析）。 */
  relatedTitles: Record<string, string>
  /** 复制 Markdown 成功后的回调（供页面显示 toast 等）。 */
  onCopied?: () => void
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

export function HelpArticleView({
  article,
  areaLabel,
  relatedTitles,
  onCopied,
}: HelpArticleViewProps) {
  const { copied, copy } = useCopyCode()
  const [linkCopied, setLinkCopied] = useState(false)
  const [feedback, setFeedback] = useState<'helpful' | 'not-helpful' | null>(() => {
    if (typeof window === 'undefined') return null
    return (
      (localStorage.getItem(`help-feedback:${article.id}`) as 'helpful' | 'not-helpful' | null) ??
      null
    )
  })
  const [copyFail, setCopyFail] = useState<string | null>(null)

  const handleCopyMarkdown = useCallback(async () => {
    setCopyFail(null)
    try {
      const markdown = await fetchArticleMarkdown(article.id)
      await copy(markdown)
      onCopied?.()
    } catch {
      setCopyFail('复制失败：可能会话已失效或网络异常，请稍后重试。')
    }
  }, [article.id, copy, onCopied])

  const handleCopyLink = useCallback(async () => {
    try {
      await copy(window.location.href)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      setCopyFail('复制链接失败，请手动复制地址栏链接。')
    }
  }, [copy])

  const handleFeedback = useCallback(
    (value: 'helpful' | 'not-helpful') => {
      localStorage.setItem(`help-feedback:${article.id}`, value)
      setFeedback(value)
    },
    [article.id],
  )

  const toc = article.headings.filter((h) => h.level >= 2 && h.level <= 3)

  return (
    <div className="space-y-6" data-testid="help-article-view">
      {/* 面包屑 */}
      <nav
        aria-label="面包屑"
        className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
        data-testid="help-breadcrumbs"
      >
        <Link href="/help" className="hover:text-foreground">
          帮助中心
        </Link>
        <span aria-hidden> / </span>
        <Link href="/help" className="hover:text-foreground">
          {areaLabel}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{article.title}</span>
      </nav>

      {/* 工具操作栏 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
            <Badge variant="primary">
              {CONTENT_TYPE_LABELS[article.contentType] ?? article.contentType}
            </Badge>
            {article.contentStatus === 'skeleton' && (
              <Badge variant="warning" data-testid="help-skeleton-badge">
                内容完善中
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{article.summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TextVariantSwitcher variant="ghost" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyMarkdown}
            data-testid="help-copy-markdown"
          >
            {copied ? (
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? '已复制 Markdown' : '复制 Markdown'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyLink} data-testid="help-copy-link">
            {linkCopied ? (
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {linkCopied ? '已复制链接' : '复制链接'}
          </Button>
        </div>
      </div>

      {copyFail && (
        <p
          className="flex items-center gap-1.5 text-sm text-destructive"
          role="alert"
          data-testid="help-copy-error"
        >
          <AlertCircle className="h-4 w-4" /> {copyFail}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
        {/* 正文 */}
        <article className="min-w-0">
          <HelpContentRenderer
            content={article.body}
            area={article.area}
            headings={article.headings}
          />
        </article>

        {/* 右侧目录 */}
        {toc.length > 0 && (
          <aside className="hidden lg:block" data-testid="help-toc">
            <nav aria-label="本页目录" className="sticky top-20 space-y-1 border-l pl-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                本页目录
              </p>
              {toc.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  className="block py-0.5 text-sm text-muted-foreground hover:text-primary"
                  style={{ paddingLeft: `${(h.level - 2) * 0.75}rem` }}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </aside>
        )}
      </div>

      {/* 反馈 */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
        data-testid="help-feedback"
      >
        <span className="text-sm text-muted-foreground">这篇文章对你有帮助吗？</span>
        {feedback ? (
          <span
            className="flex items-center gap-1 text-sm font-medium"
            data-testid="help-feedback-result"
          >
            <CheckCircle2 className="h-4 w-4 text-success" />
            感谢反馈{feedback === 'helpful' ? '（有帮助）' : '（需改进）'}。文档团队会持续完善。
          </span>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback('helpful')}
              data-testid="help-feedback-helpful"
            >
              <ThumbsUp className="mr-1 h-3.5 w-3.5" /> 有帮助
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback('not-helpful')}
              data-testid="help-feedback-not"
            >
              <ThumbsDown className="mr-1 h-3.5 w-3.5" /> 没帮助
            </Button>
          </>
        )}
      </div>

      {/* 相关内容 */}
      {article.related.length > 0 && (
        <section aria-label="相关内容" data-testid="help-related">
          <h2 className="mb-2 text-sm font-semibold">相关内容</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {article.related.map((id) => (
              <li key={id}>
                <Link
                  href={`/help/articles/${encodeURIComponent(id)}`}
                  className="block rounded border p-3 text-sm hover:border-primary/40 hover:bg-accent/40"
                >
                  {relatedTitles[id] ?? id}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 元信息 */}
      <footer
        className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground"
        data-testid="help-meta"
      >
        <span className="flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" /> 更新于 {article.updatedAt}（复核{' '}
          {article.reviewAfter}）
        </span>
        <span className="flex items-center gap-1">
          <User className="h-3.5 w-3.5" /> 责任人 {article.owner}
        </span>
        <span className="flex items-center gap-1">
          <Flag className="h-3.5 w-3.5" /> 版本 {article.productVersion} · 套餐{' '}
          {article.editions.join('/')} · 适用角色 {article.roles.join('、')}
        </span>
      </footer>

      {/* 发现错误？ */}
      <p className="text-xs text-muted-foreground">
        发现文档错误或缺口？请联系组织管理员，或到「故障排查」提交反馈。
      </p>
    </div>
  )
}
