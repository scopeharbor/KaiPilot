import { apiFetchEnvelope } from '@/lib/api-client'
import {
  type BiRiskHeatmapCell,
  type BiRiskHeatmapResponseMeta,
  type BiRiskHeatmapWarning,
} from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────────

function basePath(organizationId: number | string): string {
  return `/organizations/${organizationId}/bi/risk-heatmap`
}

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const biRiskHeatmapKeys = {
  all: (organizationId: number | string) =>
    ['organizations', String(organizationId), 'bi', 'risk-heatmap'] as const,
  // 同 bi-trend：查询键只做缓存标识，无需强制成后端的字面量联合请求类型。
  heatmap: (organizationId: number | string, query?: Record<string, unknown>) =>
    [...biRiskHeatmapKeys.all(organizationId), 'index', query ?? {}] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

export interface BiRiskHeatmapApiParams {
  organizationId: number
  metricKey?: string
  window?: string
  rowDimension?: string
  columnDimension?: string
  projectIds?: number[]
  departments?: string[]
  portfolioGroups?: string[]
  riskCategories?: string[]
  riskLevels?: string[]
  riskStatuses?: string[]
  assigneeIds?: number[]
  compareWith?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

/**
 * 获取组织 BI 风险热力图结果。
 */
export async function fetchBiRiskHeatmap(params: BiRiskHeatmapApiParams): Promise<{
  data: BiRiskHeatmapCell[]
  meta: BiRiskHeatmapResponseMeta
  warnings?: BiRiskHeatmapWarning[]
}> {
  const sp = new URLSearchParams()

  if (params.metricKey) sp.set('metricKey', params.metricKey)
  if (params.window) sp.set('window', params.window)
  if (params.rowDimension) sp.set('rowDimension', params.rowDimension)
  if (params.columnDimension) sp.set('columnDimension', params.columnDimension)
  if (params.projectIds?.length) sp.set('projectIds', params.projectIds.join(','))
  if (params.departments?.length) sp.set('departments', params.departments.join(','))
  if (params.portfolioGroups?.length) sp.set('portfolioGroups', params.portfolioGroups.join(','))
  if (params.riskCategories?.length) sp.set('riskCategories', params.riskCategories.join(','))
  if (params.riskLevels?.length) sp.set('riskLevels', params.riskLevels.join(','))
  if (params.riskStatuses?.length) sp.set('riskStatuses', params.riskStatuses.join(','))
  if (params.assigneeIds?.length) sp.set('assigneeIds', params.assigneeIds.join(','))
  if (params.compareWith) sp.set('compareWith', params.compareWith)
  if (params.sort) sp.set('sort', params.sort)
  if (params.sortDir) sp.set('sortDir', params.sortDir)
  if (params.page !== undefined) sp.set('page', String(params.page))
  if (params.perPage !== undefined) sp.set('perPage', String(params.perPage))

  const qs = sp.toString()
  const result = await apiFetchEnvelope<{
    data: BiRiskHeatmapCell[]
    meta: BiRiskHeatmapResponseMeta
    warnings?: BiRiskHeatmapWarning[]
  }>(`${basePath(params.organizationId)}${qs ? `?${qs}` : ''}`)
  return result
}
