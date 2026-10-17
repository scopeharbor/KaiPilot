import { useQuery } from '@tanstack/react-query'
import {
  portfolioDashboardKeys,
  fetchPortfolioSummary,
  fetchPortfolioProjects,
  fetchPortfolioGroups,
  fetchPortfolioTrends,
  fetchPortfolioMetricDetail,
} from '@/lib/api/portfolio-dashboard'
import type {
  PortfolioProjectListQuery,
  PortfolioGroupSliceQuery,
  PortfolioTrendQuery,
  PortfolioMetricDetailQuery,
} from '@aiproj/types'

/** 获取 PMO 组合 Dashboard 摘要 */
export function usePortfolioSummary(params?: {
  includeTrafficLight?: boolean
  includeFreshness?: boolean
}) {
  return useQuery({
    queryKey: portfolioDashboardKeys.summary(),
    queryFn: () => fetchPortfolioSummary(params),
    staleTime: 60_000,
  })
}

/** 获取 PMO 组合项目列表 */
export function usePortfolioProjects(query?: PortfolioProjectListQuery) {
  return useQuery({
    queryKey: portfolioDashboardKeys.projects(query),
    queryFn: () => fetchPortfolioProjects(query),
    staleTime: 60_000,
  })
}

/** 获取 PMO 组合分组切片 */
export function usePortfolioGroups(query?: PortfolioGroupSliceQuery) {
  return useQuery({
    queryKey: portfolioDashboardKeys.groups(query),
    queryFn: () => fetchPortfolioGroups(query),
    staleTime: 120_000,
    enabled: !!query?.groupBy,
  })
}

/** 获取 PMO 组合趋势 */
export function usePortfolioTrends(query?: PortfolioTrendQuery) {
  return useQuery({
    queryKey: portfolioDashboardKeys.trends(query),
    queryFn: () => fetchPortfolioTrends(query),
    staleTime: 120_000,
    enabled: !!query?.window,
  })
}

/** 获取 PMO 组合指标详情 */
export function usePortfolioMetricDetail(query?: PortfolioMetricDetailQuery) {
  return useQuery({
    queryKey: portfolioDashboardKeys.metricDetail(query),
    queryFn: () => fetchPortfolioMetricDetail(query),
    staleTime: 120_000,
    enabled: !!query?.metricKey,
  })
}
