import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PmoInvestmentDistributionDrillDownQuery,
  PmoInvestmentDistributionDrillDownResponse,
  PmoInvestmentDistributionQuery,
  PmoInvestmentDistributionSummary,
  PmoInvestmentDistributionTrendResponse,
  PmoInvestmentSupportedCatalogue,
} from '@aiproj/types'

const BASE = '/pmo/investment-distribution'

export const pmoInvestmentDistributionKeys = {
  all: ['pmo', 'investment-distribution'] as const,
  catalogue: () => [...pmoInvestmentDistributionKeys.all, 'catalogue'] as const,
  summary: (query?: PmoInvestmentDistributionQuery) =>
    [...pmoInvestmentDistributionKeys.all, 'summary', query ?? {}] as const,
  trends: (query?: PmoInvestmentDistributionQuery) =>
    [...pmoInvestmentDistributionKeys.all, 'trends', query ?? {}] as const,
  drillDown: (query?: PmoInvestmentDistributionDrillDownQuery) =>
    [...pmoInvestmentDistributionKeys.all, 'drill-down', query ?? {}] as const,
}

export async function fetchInvestmentDistributionCatalogue(): Promise<PmoInvestmentSupportedCatalogue> {
  const result = await apiFetchEnvelope<{ data: PmoInvestmentSupportedCatalogue }>(
    `${BASE}/catalogue`,
  )
  return result.data
}

export async function fetchInvestmentDistributionSummary(
  query?: PmoInvestmentDistributionQuery,
): Promise<PmoInvestmentDistributionSummary> {
  const result = await apiFetchEnvelope<{ data: PmoInvestmentDistributionSummary }>(
    `${BASE}${buildQuery(query)}`,
  )
  return result.data
}

export async function fetchInvestmentDistributionTrends(
  query?: PmoInvestmentDistributionQuery,
): Promise<PmoInvestmentDistributionTrendResponse> {
  return apiFetchEnvelope<PmoInvestmentDistributionTrendResponse>(
    `${BASE}/trends${buildQuery(query)}`,
  )
}

export async function fetchInvestmentDistributionDrillDown(
  query: PmoInvestmentDistributionDrillDownQuery,
): Promise<PmoInvestmentDistributionDrillDownResponse> {
  const { bucketKey, ...rest } = query
  return apiFetchEnvelope<PmoInvestmentDistributionDrillDownResponse>(
    `${BASE}/buckets/${encodeURIComponent(bucketKey)}${buildQuery(rest)}`,
  )
}

function buildQuery(
  query?: PmoInvestmentDistributionQuery &
    Partial<Pick<PmoInvestmentDistributionDrillDownQuery, 'page' | 'perPage'>>,
): string {
  const sp = new URLSearchParams()
  if (query?.basis) sp.set('basis', query.basis)
  if (query?.dimension) sp.set('dimension', query.dimension)
  if (query?.displayMode) sp.set('displayMode', query.displayMode)
  if (query?.topN) sp.set('topN', String(query.topN))
  if (query?.trendWindow) sp.set('trendWindow', query.trendWindow)
  if (query?.filterStatus) sp.set('filterStatus', query.filterStatus)
  if (query?.filterPriority) sp.set('filterPriority', query.filterPriority)
  if (query?.search) sp.set('search', query.search)
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}
