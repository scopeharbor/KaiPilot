import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PmoGroupingViewDefinition,
  PmoGroupingViewListResponse,
  PmoGroupingViewPreviewRequest,
  PmoGroupingViewPreviewResponse,
  PmoGroupingViewCreateRequest,
  PmoGroupingViewUpdateRequest,
  PmoGroupingViewSetDefaultRequest,
  PmoGroupingViewListQuery,
} from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────────

const BASE = '/pmo/grouping-views'

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const portfolioGroupingViewKeys = {
  all: ['pmo', 'grouping-views'] as const,
  list: (query?: PmoGroupingViewListQuery) =>
    [...portfolioGroupingViewKeys.all, 'list', query ?? {}] as const,
  detail: (id: string) => [...portfolioGroupingViewKeys.all, 'detail', id] as const,
  preview: () => [...portfolioGroupingViewKeys.all, 'preview'] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

/** 获取分组视图列表 */
export async function fetchGroupingViewList(
  query?: PmoGroupingViewListQuery,
): Promise<PmoGroupingViewListResponse> {
  const sp = new URLSearchParams()
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  if (query?.scope) sp.set('scope', query.scope)
  if (query?.search) sp.set('search', query.search)
  const qs = sp.toString()
  return apiFetchEnvelope<PmoGroupingViewListResponse>(`${BASE}${qs ? `?${qs}` : ''}`)
}

/** 获取分组视图详情 */
export async function fetchGroupingViewDetail(
  id: string,
): Promise<{ data: PmoGroupingViewDefinition }> {
  return apiFetchEnvelope<{ data: PmoGroupingViewDefinition }>(`${BASE}/${id}`)
}

/** 预览分组视图 */
export async function previewGroupingView(
  body: PmoGroupingViewPreviewRequest,
): Promise<{ data: PmoGroupingViewPreviewResponse }> {
  return apiFetchEnvelope<{ data: PmoGroupingViewPreviewResponse }>(`${BASE}/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** 创建分组视图 */
export async function createGroupingView(
  body: PmoGroupingViewCreateRequest,
): Promise<{ data: PmoGroupingViewDefinition }> {
  return apiFetchEnvelope<{ data: PmoGroupingViewDefinition }>(`${BASE}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** 更新分组视图 */
export async function updateGroupingView(
  id: string,
  body: PmoGroupingViewUpdateRequest,
): Promise<{ data: PmoGroupingViewDefinition }> {
  return apiFetchEnvelope<{ data: PmoGroupingViewDefinition }>(`${BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** 删除分组视图 */
export async function deleteGroupingView(id: string): Promise<void> {
  await apiFetchEnvelope<void>(`${BASE}/${id}`, { method: 'DELETE' })
}

/** 复制分组视图 */
export async function duplicateGroupingView(
  id: string,
  body?: { name?: string },
): Promise<{ data: PmoGroupingViewDefinition }> {
  return apiFetchEnvelope<{ data: PmoGroupingViewDefinition }>(`${BASE}/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

/** 设置默认视图 */
export async function setDefaultGroupingView(
  id: string,
  body: PmoGroupingViewSetDefaultRequest,
): Promise<{ data: PmoGroupingViewDefinition }> {
  return apiFetchEnvelope<{ data: PmoGroupingViewDefinition }>(`${BASE}/${id}/set-default`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
