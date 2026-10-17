import { useQuery } from '@tanstack/react-query'
import {
  fetchInvestmentDistributionCatalogue,
  fetchInvestmentDistributionDrillDown,
  fetchInvestmentDistributionSummary,
  fetchInvestmentDistributionTrends,
  pmoInvestmentDistributionKeys,
} from '@/lib/api/pmo-investment-distribution'
import type {
  PmoInvestmentDistributionDrillDownQuery,
  PmoInvestmentDistributionQuery,
} from '@aiproj/types'

export function useInvestmentDistributionCatalogue() {
  return useQuery({
    queryKey: pmoInvestmentDistributionKeys.catalogue(),
    queryFn: fetchInvestmentDistributionCatalogue,
    staleTime: 300_000,
  })
}

export function useInvestmentDistributionSummary(query?: PmoInvestmentDistributionQuery) {
  return useQuery({
    queryKey: pmoInvestmentDistributionKeys.summary(query),
    queryFn: () => fetchInvestmentDistributionSummary(query),
    staleTime: 60_000,
  })
}

export function useInvestmentDistributionTrends(query?: PmoInvestmentDistributionQuery) {
  return useQuery({
    queryKey: pmoInvestmentDistributionKeys.trends(query),
    queryFn: () => fetchInvestmentDistributionTrends(query),
    staleTime: 120_000,
  })
}

export function useInvestmentDistributionDrillDown(
  query: PmoInvestmentDistributionDrillDownQuery | undefined,
) {
  return useQuery({
    queryKey: pmoInvestmentDistributionKeys.drillDown(query),
    queryFn: () => fetchInvestmentDistributionDrillDown(query!),
    staleTime: 60_000,
    enabled: !!query?.bucketKey,
  })
}
