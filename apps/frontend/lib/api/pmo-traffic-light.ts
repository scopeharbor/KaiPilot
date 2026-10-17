import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PortfolioTrafficLightItem,
  PortfolioTrafficLightListResponse,
  PortfolioTrafficLightCounts,
  PortfolioTrafficLightDetailResponse,
  PortfolioTrafficLightReviewRequest,
  PortfolioTrafficLightReviewResponse,
  PortfolioTrafficLightListQuery,
} from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────────

const BASE = '/pmo/traffic-light'

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const pmoTrafficLightKeys = {
  all: ['pmo', 'traffic-light'] as const,
  list: (query?: PortfolioTrafficLightListQuery) =>
    [...pmoTrafficLightKeys.all, 'list', query ?? {}] as const,
  counts: () => [...pmoTrafficLightKeys.all, 'counts'] as const,
  detail: (projectId: number) => [...pmoTrafficLightKeys.all, 'detail', projectId] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

/** 获取 PMO 组合交通灯列表 */
export async function fetchTrafficLightList(
  query?: PortfolioTrafficLightListQuery,
): Promise<PortfolioTrafficLightListResponse> {
  const sp = new URLSearchParams()
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.order) sp.set('order', query.order)
  if (query?.filterStatus) {
    const statuses = Array.isArray(query.filterStatus) ? query.filterStatus : [query.filterStatus]
    sp.set('filterStatus', statuses.join(','))
  }
  if (query?.filterProjectStatus) sp.set('filterProjectStatus', query.filterProjectStatus)
  if (query?.filterStale !== undefined) sp.set('filterStale', String(query.filterStale))
  if (query?.filterWarningCode) sp.set('filterWarningCode', query.filterWarningCode)
  if (query?.filterReviewState) sp.set('filterReviewState', query.filterReviewState)
  const qs = sp.toString()
  return apiFetchEnvelope<PortfolioTrafficLightListResponse>(`${BASE}${qs ? `?${qs}` : ''}`)
}

/** 获取交通灯计数摘要 */
export async function fetchTrafficLightCounts(): Promise<PortfolioTrafficLightCounts> {
  const result = await apiFetchEnvelope<{ data: PortfolioTrafficLightCounts }>(`${BASE}/counts`)
  return result.data
}

/** 获取单个项目交通灯详情 */
export async function fetchTrafficLightDetail(
  projectId: number,
): Promise<PortfolioTrafficLightItem> {
  const result = await apiFetchEnvelope<PortfolioTrafficLightDetailResponse>(`${BASE}/${projectId}`)
  return result.data
}

/** 创建/更新复核标记 */
export async function upsertTrafficLightReview(
  projectId: number,
  body: PortfolioTrafficLightReviewRequest,
): Promise<PortfolioTrafficLightReviewResponse> {
  const result = await apiFetchEnvelope<PortfolioTrafficLightReviewResponse>(
    `${BASE}/${projectId}/review`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result
}
