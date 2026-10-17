import { useQuery } from '@tanstack/react-query'
import {
  biRiskHeatmapKeys,
  fetchBiRiskHeatmap,
  type BiRiskHeatmapApiParams,
} from '@/lib/api/bi-risk-heatmap'
import type {
  BiRiskHeatmapCell,
  BiRiskHeatmapResponseMeta,
  BiRiskHeatmapWarning,
} from '@aiproj/types'

// 页面按 `use-bi-risk-heatmap` 引这个参数类型，故在 hook 层转出。
export type { BiRiskHeatmapApiParams }

export interface UseBiRiskHeatmapResult {
  data: BiRiskHeatmapCell[]
  meta: BiRiskHeatmapResponseMeta | null
  warnings: BiRiskHeatmapWarning[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  isRestricted: boolean
  isEmpty: boolean
  isDegraded: boolean
  refetch: () => void
}

/**
 * 获取组织 BI 风险热力图数据（TanStack Query hook）。
 *
 * 处理 loading、error、empty、restricted、degraded 等状态。
 */
export function useBiRiskHeatmap(params: BiRiskHeatmapApiParams) {
  const query = useQuery({
    queryKey: biRiskHeatmapKeys.heatmap(params.organizationId, {
      metricKey: params.metricKey,
      window: params.window,
      rowDimension: params.rowDimension,
      columnDimension: params.columnDimension,
      compareWith: params.compareWith,
      sort: params.sort,
      sortDir: params.sortDir,
      page: params.page,
      perPage: params.perPage,
    }),
    queryFn: () => fetchBiRiskHeatmap(params),
    staleTime: 120_000,
    enabled: !!params.organizationId && !!params.metricKey,
  })

  const data = query.data?.data ?? []
  const meta = query.data?.meta ?? null
  const warnings = query.data?.warnings ?? []

  const isRestricted =
    data.length === 0 &&
    !query.isLoading &&
    !query.isError &&
    warnings.some((w) => w?.code?.includes('REDACTED') || w?.code?.includes('PERMISSION'))
  const isDegraded = warnings.some((w) =>
    ['STALE_SOURCE', 'CACHE_DEGRADED', 'PARTIAL_DATA', 'MISSING_SOURCE'].includes(w?.code),
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
