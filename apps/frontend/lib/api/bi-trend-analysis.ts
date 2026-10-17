import { apiFetchEnvelope } from '@/lib/api-client'
import { type BiTrendSeries, type BiTrendsResponseMeta, type BiTrendWarning } from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────────

function basePath(organizationId: number | string): string {
  return `/organizations/${organizationId}/bi/trends`
}

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const biTrendAnalysisKeys = {
  all: (organizationId: number | string) =>
    ['organizations', String(organizationId), 'bi', 'trends'] as const,
  // 查询键只做缓存标识：用 BiTrendQuery（要求 metricKeys/window/grain 必填且为字面量联合）
  // 会逼调用方对每个可选参数写 as any，这里收成可序列化记录即可。
  trends: (organizationId: number | string, query?: Record<string, unknown>) =>
    [...biTrendAnalysisKeys.all(organizationId), 'index', query ?? {}] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

export interface BiTrendAnalysisApiParams {
  organizationId: number
  metricKeys?: string[]
  window?: string
  grain?: string
  dimensions?: string[]
  projectIds?: number[]
  departments?: string[]
  roles?: string[]
  skills?: string[]
  portfolioGroups?: string[]
  riskLevels?: string[]
  compareWith?: string
  includeAnomalies?: boolean
  includeForecast?: boolean
  sort?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

/**
 * 获取组织 BI 趋势分析结果。
 */
export async function fetchBiTrendAnalysis(
  params: BiTrendAnalysisApiParams,
): Promise<{ data: BiTrendSeries[]; meta: BiTrendsResponseMeta; warnings?: BiTrendWarning[] }> {
  const sp = new URLSearchParams()

  if (params.metricKeys?.length) sp.set('metricKeys', params.metricKeys.join(','))
  if (params.window) sp.set('window', params.window)
  if (params.grain) sp.set('grain', params.grain)
  if (params.dimensions?.length) sp.set('dimensions', params.dimensions.join(','))
  if (params.projectIds?.length) sp.set('projectIds', params.projectIds.join(','))
  if (params.departments?.length) sp.set('departments', params.departments.join(','))
  if (params.roles?.length) sp.set('roles', params.roles.join(','))
  if (params.skills?.length) sp.set('skills', params.skills.join(','))
  if (params.portfolioGroups?.length) sp.set('portfolioGroups', params.portfolioGroups.join(','))
  if (params.riskLevels?.length) sp.set('riskLevels', params.riskLevels.join(','))
  if (params.compareWith) sp.set('compareWith', params.compareWith)
  if (params.includeAnomalies !== undefined)
    sp.set('includeAnomalies', String(params.includeAnomalies))
  if (params.includeForecast !== undefined)
    sp.set('includeForecast', String(params.includeForecast))
  if (params.sort) sp.set('sort', params.sort)
  if (params.sortDir) sp.set('sortDir', params.sortDir)
  if (params.page !== undefined) sp.set('page', String(params.page))
  if (params.perPage !== undefined) sp.set('perPage', String(params.perPage))

  const qs = sp.toString()
  const result = await apiFetchEnvelope<{
    data: BiTrendSeries[]
    meta: BiTrendsResponseMeta
    warnings?: BiTrendWarning[]
  }>(`${basePath(params.organizationId)}${qs ? `?${qs}` : ''}`)
  return result
}
