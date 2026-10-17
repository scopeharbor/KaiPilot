'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Search, Loader2, AlertTriangle } from 'lucide-react'
import { fetchHelpIndex, helpKeys } from '@/lib/help/query-keys'
import { buildSearchIndexFromDocuments, searchHelp } from '@/lib/help/search'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

/**
 * `/help` 首页搜索框（design E）：
 * - 顶部命中下拉（最多 6 条），键盘 ↑/↓ 选择、Enter 打开、Esc 关闭；
 * - loading/error/empty/no-result 均有可见状态；
 * - 移动端友好（点击条目直接进入文章页）。
 */
export interface HelpSearchBoxProps {
  placeholder?: string
  autoFocus?: boolean
  size?: 'default' | 'large'
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

export function HelpSearchBox({ placeholder, autoFocus, size = 'default' }: HelpSearchBoxProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const indexQuery = useQuery({
    queryKey: helpKeys.index(),
    queryFn: ({ signal }) => fetchHelpIndex(signal),
  })

  const searchIndex = useMemo(() => {
    if (!indexQuery.data) return null
    return buildSearchIndexFromDocuments(indexQuery.data.documents, indexQuery.data.learningPaths)
  }, [indexQuery.data])

  const results = useMemo(() => {
    if (!searchIndex || !deferred.trim()) return null
    return searchHelp(searchIndex, deferred, {})
  }, [searchIndex, deferred])

  const topHits = results?.hits.slice(0, 6) ?? []

  // 点击组件外部关闭下拉
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => setActiveIndex(0), [deferred])

  function openArticle(id: string) {
    setOpen(false)
    router.push(`/help/articles/${encodeURIComponent(id)}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!topHits.length) {
      if (e.key === 'Enter') {
        router.push(`/help/search?q=${encodeURIComponent(query)}`)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, topHits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = topHits[activeIndex]
      if (hit) openArticle(hit.articleId)
      else router.push(`/help/search?q=${encodeURIComponent(query)}`)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open
  const loading = indexQuery.isLoading
  const error = indexQuery.isError
  const emptyQuery = !deferred.trim()
  const noResult = Boolean(topHits.length === 0 && !emptyQuery)

  return (
    <div ref={boxRef} className="relative w-full" data-testid="help-search-box">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? '搜索帮助文章…'}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="help-search-dropdown"
          aria-label="搜索帮助文章"
          className={cn('pl-9', size === 'large' && 'h-11 text-base')}
          data-testid="help-search-input"
        />
      </div>

      {showDropdown && (
        <div
          id="help-search-dropdown"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[28rem] overflow-auto rounded-lg border bg-popover shadow-lg"
          data-testid="help-search-dropdown"
        >
          {loading ? (
            <div
              className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"
              data-testid="help-search-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" /> 正在加载索引…
            </div>
          ) : error ? (
            <div
              className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
              data-testid="help-search-error"
            >
              <span className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" /> 索引加载失败
              </span>
              <Button variant="ghost" size="sm" onClick={() => indexQuery.refetch()}>
                重试
              </Button>
            </div>
          ) : emptyQuery ? (
            <div
              className="px-4 py-3 text-sm text-muted-foreground"
              data-testid="help-search-empty"
            >
              输入关键词开始搜索
            </div>
          ) : noResult ? (
            <div className="px-4 py-3 text-sm" data-testid="help-search-no-result">
              <p className="mb-1 font-medium">没有找到匹配文章</p>
              {results?.suggestions.map((s) => (
                <p key={s} className="text-xs text-muted-foreground">
                  {s}
                </p>
              ))}
            </div>
          ) : (
            <ul data-testid="help-search-results">
              {topHits.map((hit, i) => (
                <li key={hit.articleId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    onClick={() => openArticle(hit.articleId)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      'block w-full px-4 py-2.5 text-left hover:bg-accent/60',
                      i === activeIndex && 'bg-accent/60',
                    )}
                    data-testid={`help-search-hit-${i}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{hit.title}</span>
                      <Badge variant="neutral" className="shrink-0 text-[10px]">
                        {CONTENT_TYPE_LABELS[hit.contentType] ?? hit.contentType}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {hit.summary}
                    </span>
                    {hit.matchedHeadings[0] && (
                      <span className="mt-0.5 block truncate text-xs text-primary/70">
                        § {hit.matchedHeadings[0]}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
