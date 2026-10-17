import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  SearchEntityType,
  SearchResultItem,
  SearchResultMeta,
  SearchSort,
  SearchScope,
} from '@aiproj/types'

export type { SearchEntityType, SearchResultItem, SearchResultMeta, SearchSort, SearchScope }

/** 搜索请求参数 */
export interface SearchFilters {
  keyword?: string
  entityTypes?: SearchEntityType[]
  projectIds?: number[]
  status?: string[]
  assigneeIds?: number[]
  tagIds?: number[]
  dateFrom?: string
  dateTo?: string
  scope?: SearchScope
  sort?: SearchSort[]
  page?: number
  perPage?: number
}

/** 搜索响应 */
export interface SearchResponse {
  data: SearchResultItem[]
  meta: SearchResultMeta
}

/** 搜索建议 */
export interface SearchSuggestion {
  entityType: SearchEntityType
  entityId: number
  title: string
  summary: string | null
  target: string
  projectId?: number | null
}

/** 搜索建议响应 */
export interface SearchSuggestionsResponse {
  data: SearchSuggestion[]
}

export const searchApi = {
  search: (filters: SearchFilters) =>
    apiFetchEnvelope<SearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify(filters),
      headers: { 'Content-Type': 'application/json' },
    }),

  suggestions: (q: string, limit = 5) =>
    apiFetch<SearchSuggestionsResponse>(
      `/search/suggestions?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
}

export const searchKeys = {
  all: ['search'] as const,
  results: (filters: SearchFilters) => [...searchKeys.all, 'results', filters] as const,
  suggestions: (q: string) => [...searchKeys.all, 'suggestions', q] as const,
}
