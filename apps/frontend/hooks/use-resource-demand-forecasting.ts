import { useQuery } from '@tanstack/react-query'
import type {
  ResourceDemandForecastQuery,
  ForecastSummary,
  ForecastDemandCurve,
  ForecastGapAnalysis,
  ForecastProjectDriver,
  ForecastSkillDriver,
  ForecastTrendBaseline,
  ForecastDrillDownResponse,
  ForecastDrillDownQuery,
  ForecastAiAdvisory,
} from '@aiproj/types'
import {
  resourceDemandForecastingKeys,
  fetchForecastSummary,
  fetchForecastDemandCurves,
  fetchForecastGapAnalysis,
  fetchForecastProjectDrivers,
  fetchForecastSkillDrivers,
  fetchForecastTrendBaseline,
  fetchForecastDrillDown,
  fetchForecastAiAdvisory,
} from '@/lib/api/resource-demand-forecasting'

/**
 * 资源需求预测 — TanStack Query hooks（v3-resource-demand-forecasting §6.1）。
 *
 * 所有 hooks 使用组织隔离的 query keys，筛选参数变化时自动重新请求。
 * query cache 由 TanStack Query 管理，不额外轮询。
 *
 * AI advisory 仅在用户手动触发时调用，不走自动请求。
 */

export function useForecastSummary(
  organizationId: number,
  query: Partial<ResourceDemandForecastQuery>,
) {
  return useQuery<ForecastSummary>({
    queryKey: resourceDemandForecastingKeys.summary(organizationId, query),
    queryFn: () => fetchForecastSummary(organizationId, query),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useForecastDemandCurves(
  organizationId: number,
  query: Partial<ResourceDemandForecastQuery>,
) {
  return useQuery<ForecastDemandCurve>({
    queryKey: resourceDemandForecastingKeys.demandCurves(organizationId, query),
    queryFn: () => fetchForecastDemandCurves(organizationId, query),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useForecastGapAnalysis(
  organizationId: number,
  query: Partial<ResourceDemandForecastQuery>,
) {
  return useQuery<ForecastGapAnalysis>({
    queryKey: resourceDemandForecastingKeys.gapAnalysis(organizationId, query),
    queryFn: () => fetchForecastGapAnalysis(organizationId, query),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useForecastProjectDrivers(
  organizationId: number,
  query: Partial<ResourceDemandForecastQuery>,
) {
  return useQuery<{
    data: ForecastProjectDriver[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }>({
    queryKey: resourceDemandForecastingKeys.projectDrivers(organizationId, query),
    queryFn: () => fetchForecastProjectDrivers(organizationId, query),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useForecastSkillDrivers(
  organizationId: number,
  query: Partial<ResourceDemandForecastQuery>,
) {
  return useQuery<{
    data: ForecastSkillDriver[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }>({
    queryKey: resourceDemandForecastingKeys.skillDrivers(organizationId, query),
    queryFn: () => fetchForecastSkillDrivers(organizationId, query),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useForecastTrendBaseline(
  organizationId: number,
  query: Partial<ResourceDemandForecastQuery>,
) {
  return useQuery<ForecastTrendBaseline>({
    queryKey: resourceDemandForecastingKeys.trendBaseline(organizationId, query),
    queryFn: () => fetchForecastTrendBaseline(organizationId, query),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useForecastDrillDown(
  organizationId: number,
  drillDownQuery: ForecastDrillDownQuery | null,
) {
  return useQuery<ForecastDrillDownResponse>({
    queryKey: drillDownQuery
      ? resourceDemandForecastingKeys.drillDown(organizationId, drillDownQuery)
      : resourceDemandForecastingKeys.all,
    queryFn: () => {
      if (!drillDownQuery) throw new Error('No drill-down query')
      return fetchForecastDrillDown(organizationId, drillDownQuery)
    },
    enabled: !!organizationId && !!drillDownQuery,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })
}

/**
 * AI advisory hook — 仅手动触发，不走自动请求。
 * 使用 query 而非 mutation，因为 advisory 本身是只读的，不产生写入副作用。
 */
export function useForecastAiAdvisory(organizationId: number, enabled: boolean) {
  return useQuery<ForecastAiAdvisory>({
    queryKey: resourceDemandForecastingKeys.aiAdvisory(organizationId),
    queryFn: () => fetchForecastAiAdvisory(organizationId),
    enabled: !!organizationId && enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
}
