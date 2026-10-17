'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, SearchX } from 'lucide-react'
import { fetchHelpIndex, helpKeys } from '@/lib/help/query-keys'
import { buildSearchIndexFromDocuments, searchHelp } from '@/lib/help/search'
import { HELP_CONTENT_TYPES, HELP_ROLES } from '@/lib/help/types'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'

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

const ROLE_LABELS: Record<string, string> = {
  system_admin: '系统管理员',
  org_admin: '组织管理员',
  project_manager: '项目经理',
  member: '成员',
  external_collaborator: '外部协作者',
  readonly_observer: '只读观察者',
}

/**
 * 搜索页（/help/search）：查询 + 角色/模块/内容类型筛选 + 结果列表。
 * loading（骨架）/error（重试）/no-result（术语与支持路径建议）状态齐全。
 */
export function HelpSearchResults({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  const [module, setModule] = useState('all')
  const [role, setRole] = useState('all')
  const [contentType, setContentType] = useState('all')
  const deferred = useDeferredValue(query)

  // URL 的 ?q= 是查询真源：同一路由内导航（/help/search?q=A → ?q=B）时
  // 组件不会重新挂载，这里跟随 URL 同步重置输入（E2E 矩阵验证）。
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  useEffect(() => {
    setQuery(urlQuery)
  }, [urlQuery])

  const indexQuery = useQuery({
    queryKey: helpKeys.index(),
    queryFn: ({ signal }) => fetchHelpIndex(signal),
  })

  const searchIndex = useMemo(() => {
    if (!indexQuery.data) return null
    return buildSearchIndexFromDocuments(indexQuery.data.documents, indexQuery.data.learningPaths)
  }, [indexQuery.data])

  const result = useMemo(() => {
    if (!searchIndex || !deferred.trim()) return null
    return searchHelp(searchIndex, deferred, {
      role: role === 'all' ? undefined : role,
      module: module === 'all' ? undefined : module,
      contentType: contentType === 'all' ? undefined : contentType,
    })
  }, [searchIndex, deferred, role, module, contentType])

  const areaById = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of indexQuery.data?.areas ?? []) m.set(a.id, a.label)
    return m
  }, [indexQuery.data])

  return (
    <div className="space-y-6" data-testid="help-search-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">搜索帮助文档</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            支持标题、摘要、章节与正文全文检索；空结果会给出术语与支持路径建议。
          </p>
        </div>
        <TextVariantSwitcher variant="ghost" className="shrink-0" />
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="输入关键词，例如：报表、甘特图、Copilot、部署…"
        aria-label="搜索帮助文章"
        className="h-11"
        data-testid="help-search-page-input"
      />

      {indexQuery.isLoading ? (
        <div className="space-y-2" data-testid="help-search-page-loading" aria-busy="true">
          {[0, 1, 2, 3].map((k) => (
            <Skeleton key={k} className="h-16 w-full" />
          ))}
        </div>
      ) : indexQuery.isError ? (
        <div
          className="flex items-center justify-between rounded-lg border p-4"
          data-testid="help-search-page-error"
        >
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" /> 帮助索引加载失败，请重试。
          </span>
          <Button variant="secondary" size="sm" onClick={() => indexQuery.refetch()}>
            重试
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3" data-testid="help-search-filters">
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger className="w-40" aria-label="按模块筛选">
                <SelectValue placeholder="全部模块" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模块</SelectItem>
                {indexQuery.data?.areas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-40" aria-label="按角色筛选">
                <SelectValue placeholder="全部角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {HELP_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger className="w-40" aria-label="按内容类型筛选">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {HELP_CONTENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CONTENT_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!deferred.trim() ? (
            <div
              className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="help-search-page-empty"
            >
              <SearchX className="mx-auto mb-2 h-8 w-8 opacity-50" />
              输入关键词开始搜索。试试：「创建项目」「AI 连接」「权限」「Docker 部署」。
            </div>
          ) : !result || result.total === 0 ? (
            <div
              className="rounded-lg border border-dashed p-8"
              data-testid="help-search-page-no-result"
            >
              <p className="mb-2 font-medium">没有找到匹配「{query}」的文章</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result?.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
                <li>也可直接到「设置」查看对应功能页，或联系组织管理员反馈文档缺口。</li>
              </ul>
            </div>
          ) : (
            <div className="space-y-3" data-testid="help-search-page-results">
              <p className="text-sm text-muted-foreground">共 {result.total} 篇匹配</p>
              {result.hits.map((hit) => (
                <Link
                  key={hit.articleId}
                  href={`/help/articles/${encodeURIComponent(hit.articleId)}`}
                  className="block rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                  data-testid={`help-search-result-${hit.articleId}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{hit.title}</span>
                    <Badge variant="neutral">
                      {CONTENT_TYPE_LABELS[hit.contentType] ?? hit.contentType}
                    </Badge>
                    <Badge variant="neutral">{areaById.get(hit.area) ?? hit.area}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      更新于 {hit.updatedAt}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{hit.summary}</span>
                  {hit.matchedHeadings.length > 0 && (
                    <span className="mt-1 block text-xs text-primary/70">
                      § {hit.matchedHeadings.join(' · ')}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
