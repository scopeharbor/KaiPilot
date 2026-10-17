import { useQuery } from '@tanstack/react-query'
import {
  biTrendAnalysisKeys,
  fetchBiTrendAnalysis,
  type BiTrendAnalysisApiParams,
} from '@/lib/api/bi-trend-analysis'
import type { BiTrendSeries, BiTrendsResponseMeta, BiTrendWarning } from '@aiproj/types'

// 页面按 `use-bi-trend-analysis` 引这个参数类型，故在 hook 层转出。
export type { BiTrendAnalysisApiParams }

export interface UseBiTrendAnalysisResult {
  data: BiTrendSeries[]
  meta: BiTrendsResponseMeta | null
  warnings: BiTrendWarning[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  isRestricted: boolean
  isEmpty: boolean
  isDegraded: boolean
  refetch: () => void
}

/**
 * 获取组织 BI 趋势分析数据（TanStack Query hook）。
 *
 * 处理 loading、error、empty、restricted、degraded 等状态。
 */
export function useBiTrendAnalysis(params: BiTrendAnalysisApiParams) {
  const query = useQuery({
    queryKey: biTrendAnalysisKeys.trends(params.organizationId, {
      metricKeys: params.metricKeys,
      window: params.window,
      grain: params.grain,
      dimensions: params.dimensions,
      compareWith: params.compareWith,
      includeAnomalies: params.includeAnomalies,
      includeForecast: params.includeForecast,
      sort: params.sort,
      sortDir: params.sortDir,
      page: params.page,
      perPage: params.perPage,
    }),
    queryFn: () => fetchBiTrendAnalysis(params),
    staleTime: 120_000,
    enabled: !!params.organizationId,
  })

  const data = query.data?.data ?? []
  const meta = query.data?.meta ?? null
  const warnings = query.data?.warnings ?? []

  // 状态推导
  const isRestricted =
    data.length === 0 &&
    !query.isLoading &&
    !query.isError &&
    warnings.some((w) => w?.code?.includes('PERMISSION') || w?.code?.includes('REDACTED'))
  const isDegraded = warnings.some((w) =>
    ['MISSING_BUCKETS', 'STALE_SOURCE', 'CACHE_DEGRADED', 'INSUFFICIENT_HISTORY'].includes(w?.code),
  )
  const isEmpty = data.length === 0 && !query.isLoading && !query.isError && !isRestricted

  return {
    data,
    meta,
    warnings,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    isRestricted,
    isEmpty,
    isDegraded,
    refetch: query.refetch,
  }
}
