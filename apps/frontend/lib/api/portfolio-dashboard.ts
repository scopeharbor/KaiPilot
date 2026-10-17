import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PortfolioDashboardSummary,
  PortfolioProjectListResponse,
  PortfolioGroupSliceResponse,
  PortfolioTrendResponse,
  PortfolioMetricDetail,
  PortfolioProjectListQuery,
  PortfolioGroupSliceQuery,
  PortfolioTrendQuery,
  PortfolioMetricDetailQuery,
} from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────────

const BASE = '/pmo/portfolio-dashboard'

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const portfolioDashboardKeys = {
  all: ['pmo', 'portfolio-dashboard'] as const,
  summary: () => [...portfolioDashboardKeys.all, 'summary'] as const,
  projects: (query?: PortfolioProjectListQuery) =>
    [...portfolioDashboardKeys.all, 'projects', query ?? {}] as const,
  groups: (query?: PortfolioGroupSliceQuery) =>
    [...portfolioDashboardKeys.all, 'groups', query ?? {}] as const,
  trends: (query?: PortfolioTrendQuery) =>
    [...portfolioDashboardKeys.all, 'trends', query ?? {}] as const,
  metricDetail: (query?: PortfolioMetricDetailQuery) =>
    [...portfolioDashboardKeys.all, 'metric-detail', query ?? {}] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

export async function fetchPortfolioSummary(params?: {
  includeTrafficLight?: boolean
  includeFreshness?: boolean
}): Promise<PortfolioDashboardSummary> {
  const sp = new URLSearchParams()
  if (params?.includeTrafficLight) sp.set('includeTrafficLight', 'true')
  if (params?.includeFreshness) sp.set('includeFreshness', 'true')
  const qs = sp.toString()
  const result = await apiFetchEnvelope<{ data: PortfolioDashboardSummary }>(
    `${BASE}${qs ? `?${qs}` : ''}`,
  )
  return result.data
}

export async function fetchPortfolioProjects(
  query?: PortfolioProjectListQuery,
): Promise<PortfolioProjectListResponse> {
  const sp = new URLSearchParams()
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.order) sp.set('order', query.order)
  if (query?.filterStatus) sp.set('filterStatus', query.filterStatus)
  if (query?.filterHealth) sp.set('filterHealth', query.filterHealth)
  if (query?.search) sp.set('search', query.search)
  const qs = sp.toString()
  return apiFetchEnvelope<PortfolioProjectListResponse>(`${BASE}/projects${qs ? `?${qs}` : ''}`)
}

export async function fetchPortfolioGroups(
  query?: PortfolioGroupSliceQuery,
): Promise<PortfolioGroupSliceResponse> {
  const sp = new URLSearchParams()
  if (query?.groupBy) sp.set('groupBy', query.groupBy)
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.order) sp.set('order', query.order)
  const qs = sp.toString()
  return apiFetchEnvelope<PortfolioGroupSliceResponse>(`${BASE}/groups${qs ? `?${qs}` : ''}`)
}

export async function fetchPortfolioTrends(
  query?: PortfolioTrendQuery,
): Promise<PortfolioTrendResponse> {
  const sp = new URLSearchParams()
  if (query?.window) sp.set('window', query.window)
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  const qs = sp.toString()
  return apiFetchEnvelope<PortfolioTrendResponse>(`${BASE}/trends${qs ? `?${qs}` : ''}`)
}

export async function fetchPortfolioMetricDetail(
  query?: PortfolioMetricDetailQuery,
): Promise<PortfolioMetricDetail> {
  const sp = new URLSearchParams()
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  const qs = sp.toString()
  const key = query?.metricKey ?? 'total_projects'
  const result = await apiFetchEnvelope<{ data: PortfolioMetricDetail }>(
    `${BASE}/metrics/${key}${qs ? `?${qs}` : ''}`,
  )
  return result.data
}
