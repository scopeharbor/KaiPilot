'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchResultCard, TYPE_LABELS } from '@/components/search/SearchResultCard'
import { useAuthStore } from '@/stores/auth-store'
import { useSearch } from '@/hooks/use-search'
import { SEARCH_ENTITY_TYPES } from '@aiproj/types'
import type { SearchEntityType, SearchFilters } from '@/lib/api/search'

// ============================================================
// 常量
// ============================================================

const ENTITY_TYPE_OPTIONS = SEARCH_ENTITY_TYPES.map((t) => ({
  value: t,
  label: TYPE_LABELS[t] ?? t,
}))

const PER_PAGE_OPTIONS = [10, 20, 30, 50]

// ============================================================
// SearchPage
// ============================================================

export default function SearchPage() {
  const searchParams = useSearchParams()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // 从 URL 参数恢复搜索条件
  const [keyword, setKeyword] = React.useState(searchParams.get('q') ?? '')
  const [entityTypes, setEntityTypes] = React.useState<SearchEntityType[]>([])
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState(20)
  const [dateFrom, setDateFrom] = React.useState(searchParams.get('dateFrom') ?? '')
  const [dateTo, setDateTo] = React.useState(searchParams.get('dateTo') ?? '')
  const [submitted, setSubmitted] = React.useState(false)

  // 当前筛选
  const filters: SearchFilters = React.useMemo(() => {
    if (!submitted) return { page: 1, perPage: 20 }
    return {
      keyword: keyword || undefined,
      entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
      page,
      perPage,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }
  }, [keyword, entityTypes, page, perPage, dateFrom, dateTo, submitted])

  const query = useSearch(filters)

  // 当已认证且无筛选时自动搜索
  React.useEffect(() => {
    if (isAuthenticated && !submitted && keyword) {
      setSubmitted(true)
    }
  }, [isAuthenticated, keyword, submitted])

  // 处理搜索提交
  const handleSearch = React.useCallback(() => {
    setPage(1)
    setSubmitted(true)
  }, [])

  // 处理关键词回车
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearch()
      }
    },
    [handleSearch],
  )

  // 实体类型切换
  const toggleEntityType = React.useCallback((type: SearchEntityType) => {
    setEntityTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }, [])

  // 分页
  const totalPages = query.data?.meta?.totalPages ?? 1
  const currentPage = query.data?.meta?.page ?? page
  const totalResults = query.data?.meta?.total ?? 0

  // 不可信状态
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <EmptyState icon={AlertTriangle} title="请先登录" description="需要登录才能使用高级搜索" />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Search className="w-6 h-6" />
        高级搜索
      </h1>

      {/* 搜索栏 */}
      <div className="space-y-4 mb-6">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入关键词搜索项目、任务、文件..."
              className="w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button onClick={handleSearch} disabled={query.isLoading}>
            {query.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Search className="w-4 h-4 mr-1" />
            )}
            搜索
          </Button>
        </div>

        {/* 实体类型筛选 */}
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-gray-500 py-1">类型：</span>
          {ENTITY_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleEntityType(opt.value)}
              className={cn(
                'px-3 py-1 text-sm rounded-full border transition-colors',
                entityTypes.includes(opt.value)
                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 时间范围 */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-500">时间：</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border rounded text-sm"
          />
          <span className="text-gray-400 text-sm">至</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 border rounded text-sm"
          />
          <label className="text-sm text-gray-500 ml-4">
            每页：
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value))
                setPage(1)
              }}
              className="ml-1 px-2 py-1 border rounded text-sm"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 搜索结果 */}
      {!submitted ? (
        <div className="text-center py-20 text-gray-400">
          <FileSearch className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p>输入关键词或选择筛选条件开始搜索</p>
        </div>
      ) : query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4 border rounded-lg">
              <Skeleton className="h-5 w-3/4 mb-2" />
              <Skeleton className="h-4 w-1/2 mb-2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className="text-center py-16">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-600 mb-4">搜索请求失败，请稍后重试</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> 重试
          </Button>
        </div>
      ) : query.data?.data && query.data.data.length === 0 ? (
        <div className="text-center py-16">
          <FileSearch className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">未找到匹配结果</p>
          {keyword && <p className="text-gray-400 text-sm mt-1">尝试更换关键词或调整筛选条件</p>}
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setKeyword('')
              setEntityTypes([])
              setSubmitted(false)
            }}
          >
            清除筛选
          </Button>
        </div>
      ) : (
        <>
          {/* 结果统计 */}
          <div className="text-sm text-gray-500 mb-4 flex items-center justify-between">
            <span>
              共 {totalResults} 条结果
              {query.data?.meta?.degradedSources && query.data.meta.degradedSources.length > 0 && (
                <span className="text-amber-500 ml-2">（部分来源不可用）</span>
              )}
            </span>
          </div>

          {/* 结果列表 */}
          <div className="space-y-2">
            {query.data!.data.map((item) => (
              <SearchResultCard key={`${item.entityType}-${item.entityId}`} item={item} />
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" /> 上一页
              </Button>
              <span className="text-sm text-gray-500 px-4">
                第 {currentPage} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页 <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
