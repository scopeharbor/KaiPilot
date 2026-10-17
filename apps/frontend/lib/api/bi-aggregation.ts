// apps/frontend/lib/api/bi-aggregation.ts
// v3-bi-data-aggregation-service §7.1：组织级 aggregation API client、
// query serialization、错误信封解析和低敏 details 保留。

import { apiFetchEnvelope } from '@/lib/api-client'
import type { BiAggregationResponse, BiAggregationErrorResponse } from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────

function basePath(organizationId: number | string): string {
  return `/organizations/${organizationId}/bi/aggregations`
}

// ─── API 参数 ──────────────────────────────────────────────────────────────

export interface BiAggregationApiParams {
  organizationId: number
  scope?: string
  metricKeys: string[]
  dimensions?: string[]
  filters?: Array<{ dimension: string; operator: string; value: unknown }>
  window?: string
  grain?: string
  compareWith?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  perPage?: number
  includeSources?: boolean
  includeEvidence?: boolean
}

// ─── Query Keys ────────────────────────────────────────────────────────────

export const biAggregationKeys = {
  all: (organizationId: number | string) =>
    ['organizations', String(organizationId), 'bi', 'aggregations'] as const,
  aggregation: (organizationId: number | string, params?: Partial<BiAggregationApiParams>) =>
    [...biAggregationKeys.all(organizationId), 'index', params ?? {}] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────

/**
 * 获取组织 BI 聚合结果。
 */
export async function fetchBiAggregation(
  params: BiAggregationApiParams,
): Promise<BiAggregationResponse> {
  const sp = new URLSearchParams()

  if (params.scope) sp.set('scope', params.scope)
  if (params.metricKeys?.length) sp.set('metricKeys', params.metricKeys.join(','))
  if (params.dimensions?.length) sp.set('dimensions', params.dimensions.join(','))
  if (params.window) sp.set('window', params.window)
  if (params.grain) sp.set('grain', params.grain)
  if (params.compareWith) sp.set('compareWith', params.compareWith)
  if (params.sort) sp.set('sort', params.sort)
  if (params.sortDir) sp.set('sortDir', params.sortDir)
  if (params.page !== undefined) sp.set('page', String(params.page))
  if (params.perPage !== undefined) sp.set('perPage', String(params.perPage))
  if (params.includeSources !== undefined) sp.set('includeSources', String(params.includeSources))
  if (params.includeEvidence !== undefined)
    sp.set('includeEvidence', String(params.includeEvidence))

  // JSON filters
  if (params.filters?.length) {
    sp.set('filters', JSON.stringify(params.filters))
  }

  const qs = sp.toString()
  const result = await apiFetchEnvelope<BiAggregationResponse>(
    `${basePath(params.organizationId)}${qs ? `?${qs}` : ''}`,
  )
  return result
}

/**
 * 解析 BI 聚合 API 错误信封，返回低敏 details。
 */
export function parseBiAggregationError(error: unknown): {
  code: string
  message: string
  details?: unknown
} {
  if (error && typeof error === 'object' && 'error' in error) {
    const err = (error as BiAggregationErrorResponse).error
    return {
      code: err?.code ?? 'UNKNOWN',
      message: err?.message ?? '未知 BI 聚合查询错误',
      details: err?.details,
    }
  }
  return { code: 'UNKNOWN', message: '未知 BI 聚合查询错误' }
}
