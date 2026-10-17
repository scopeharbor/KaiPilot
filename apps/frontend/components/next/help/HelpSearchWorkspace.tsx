'use client'

import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, BookOpen, Search, SearchX } from 'lucide-react'
import { buildSearchIndexFromDocuments, searchHelp, tokenizeText } from '@/lib/help/search'
import type { HelpSearchDocument } from '@/lib/help/types'

/**
 * 帮助中心新轨实时搜索工作区（v3-ui-next-help-knowledge-domain W1 · tasks 1.7，
 * spec「帮助中心实时搜索与关键词过滤」）。
 *
 * - URL `?q=` 为查询单一事实来源：页面 RSC 读取 searchParams 并以 `key={q}`
 *   强制重挂载，软导航下输入与结果毫秒级同步（杜绝 Next.js 同路由 query
 *   不同步问题）；
 * - 搜索索引（documents）由 RSC 经 `loadArticlesCached` 直出后传入，检索在
 *   客户端内存中完成，零网络请求、零业务依赖；
 * - 命中关键词在标题/摘要中以墨水金高亮标签（--nx-role-accent）突出；
 * - 空词引导 + 热门词条、无结果语义化空态 + 「浏览产品模块」返回，
 *   结果卡片带模块微标与更新日期。
 */

export interface HelpSearchWorkspaceProps {
  /** URL ?q= 初始值（页面 key={q} 重挂载后恒等于地址栏参数）。 */
  initialQuery: string
  /** 搜索索引文档（与 /api/help/index 同构，RSC 直出）。 */
  documents: HelpSearchDocument[]
  /** 模块 id → 标签（导航树 area 投影）。 */
  areas: Array<{ id: string; label: string }>
}

const HOT_TERMS = ['创建项目', '甘特图', 'AI 连接', '权限', 'Docker 部署']

/** 关键词 token 按长度降序聚合为高亮正则（含大小写容忍）。 */
function highlightParts(text: string, tokens: string[]): Array<{ text: string; hit: boolean }> {
  if (!text || tokens.length === 0) return [{ text, hit: false }]
  const ordered = [...new Set(tokens)].sort((a, b) => b.length - a.length)
  const pattern = ordered.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  if (!pattern) return [{ text, hit: false }]
  const re = new RegExp(`(${pattern})`, 'gi')
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), hit: false })
    parts.push({ text: match[0], hit: true })
    cursor = match.index + match[0].length
    if (match[0].length === 0) re.lastIndex += 1
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
  return parts
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }): ReactNode {
  const parts = highlightParts(text, tokens)
  if (parts.every((part) => !part.hit)) return text
  return parts.map((part, index) =>
    part.hit ? (
      <mark
        key={`${part.text}-${index}`}
        data-testid="next-help-search-mark"
        className="rounded-sm bg-[var(--nx-role-accent)]/20 px-0.5 text-[var(--nx-role-accent)]"
      >
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}

export function HelpSearchWorkspace({ initialQuery, documents, areas }: HelpSearchWorkspaceProps) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const deferred = useDeferredValue(query)

  const areaLabels = useMemo(() => new Map(areas.map((area) => [area.id, area.label])), [areas])
  const searchIndex = useMemo(() => buildSearchIndexFromDocuments(documents, []), [documents])
  const result = useMemo(() => {
    if (!deferred.trim()) return null
    return searchHelp(searchIndex, deferred)
  }, [searchIndex, deferred])
  const hitTokens = useMemo(() => tokenizeText(deferred.trim()), [deferred])

  function commitQuery(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return
    router.push(`/next/help/search?q=${encodeURIComponent(trimmed)}`)
  }

  function pickHotTerm(term: string) {
    setQuery(term)
    commitQuery(term)
  }

  const hasQuery = deferred.trim().length > 0

  return (
    <div data-testid="next-help-search-workspace" className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--nx-text-primary)]">
          搜索帮助文档
        </h1>
        <p className="text-xs text-[var(--nx-text-muted)]">
          支持标题、摘要、章节与正文全文检索；输入词即时收敛，回车固定为可分享链接。
        </p>
      </header>

      {/* 搜索输入（URL 为单一事实来源：Enter / 热词后由 key={q} 重挂载完成同步） */}
      <form
        role="search"
        className="relative w-full"
        onSubmit={(event) => {
          event.preventDefault()
          commitQuery(query)
        }}
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--nx-text-muted)]"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitQuery(query)
            }
          }}
          aria-label="搜索帮助文章"
          placeholder="输入关键词，例如：报表、甘特图、Copilot、部署…"
          data-testid="next-help-search-input"
          className="h-11 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] pl-10 pr-20 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <button
          type="submit"
          data-testid="next-help-search-submit"
          className="absolute right-1.5 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          搜索
        </button>
      </form>

      {!hasQuery ? (
        /* 空词引导 + 热门搜索 */
        <div
          data-testid="next-help-search-empty"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] p-8 text-center"
        >
          <SearchX className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">请输入关键词开始搜索</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {HOT_TERMS.map((term) => (
              <button
                key={term}
                type="button"
                data-testid={`next-help-search-hot-${term}`}
                onClick={() => pickHotTerm(term)}
                className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      ) : !result || result.total === 0 ? (
        /* 无匹配空态 */
        <div
          data-testid="next-help-search-no-result"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] p-8 text-center"
        >
          <SearchX className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">未找到相关文档</p>
          <p className="max-w-xl text-xs leading-5 text-[var(--nx-text-muted)]">
            没有找到匹配「{deferred}」的文档。换一个更短的关键词或同义词再试：
          </p>
          {result && result.suggestions.length > 0 && (
            <ul className="max-w-xl list-disc space-y-0.5 pl-5 text-left text-xs text-[var(--nx-text-muted)]">
              {result.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          )}
          <Link
            href="/next/help"
            data-testid="next-help-search-browse-modules"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            浏览产品模块
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      ) : (
        /* 结果列表 */
        <div data-testid="next-help-search-results" className="flex flex-col gap-3">
          <p className="text-xs text-[var(--nx-text-muted)]">共 {result.total} 篇匹配</p>
          {result.hits.map((hit) => (
            <Link
              key={hit.articleId}
              href={`/next/help/articles/${encodeURIComponent(hit.articleId)}`}
              data-testid={`next-help-search-result-${hit.articleId}`}
              className="block rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 hover:border-[var(--nx-border-focus)]"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="next-help-search-hit-title"
                  className="text-sm font-medium text-[var(--nx-text-primary)]"
                >
                  <Highlight text={hit.title} tokens={hitTokens} />
                </span>
                <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-secondary)]">
                  {areaLabels.get(hit.area) ?? hit.area}
                </span>
              </span>
              <span
                data-testid="next-help-search-hit-summary"
                className="mt-1.5 block text-xs leading-5 text-[var(--nx-text-muted)]"
              >
                <Highlight text={hit.summary} tokens={hitTokens} />
              </span>
              <span className="mt-2 block font-mono text-[10px] text-[var(--nx-text-muted)]">
                更新于 {hit.updatedAt}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default HelpSearchWorkspace
