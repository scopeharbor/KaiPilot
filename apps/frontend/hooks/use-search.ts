'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { searchApi, searchKeys, type SearchFilters } from '@/lib/api/search'

/**
 * 通用搜索查询 hook。
 */
export function useSearch(filters: SearchFilters) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: searchKeys.results(filters),
    queryFn: () => searchApi.search(filters),
    staleTime: 15_000,
    enabled: isAuthenticated,
  })
}

/**
 * 搜索建议 hook（供命令面板使用）。
 */
export function useSearchSuggestions(q: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: searchKeys.suggestions(q),
    queryFn: () => searchApi.suggestions(q),
    staleTime: 30_000,
    enabled: isAuthenticated && q.length > 0,
  })
}

/**
 * 失效搜索缓存。
 */
export function useInvalidateSearch() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: searchKeys.all })
  }
}
