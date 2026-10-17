import { apiFetchEnvelope, apiFetch } from '@/lib/api-client'
import type {
  CustomViewResponse,
  CustomViewListResponse,
  CustomViewBaseType,
  CustomViewConfig,
  CustomViewVisibility,
  CreateCustomViewRequest,
  UpdateCustomViewRequest,
  ReorderCustomViewsRequest,
  CloneCustomViewRequest,
} from '@aiproj/types'

export type {
  CustomViewResponse,
  CustomViewListResponse,
  CustomViewBaseType,
  CustomViewConfig,
  CustomViewVisibility,
  CreateCustomViewRequest,
  UpdateCustomViewRequest,
  ReorderCustomViewsRequest,
  CloneCustomViewRequest,
}

const base = (projectId: number) => `/projects/${projectId}/custom-views`

export const customViewsApi = {
  list: (projectId: number) => apiFetchEnvelope<CustomViewListResponse>(base(projectId)),

  show: (projectId: number, viewId: number) =>
    apiFetch<CustomViewResponse>(`${base(projectId)}/${viewId}`),

  create: (projectId: number, data: CreateCustomViewRequest) =>
    apiFetch<CustomViewResponse>(base(projectId), {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: number, viewId: number, data: UpdateCustomViewRequest) =>
    apiFetch<CustomViewResponse>(`${base(projectId)}/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  destroy: (projectId: number, viewId: number) =>
    apiFetch<void>(`${base(projectId)}/${viewId}`, { method: 'DELETE' }),

  clone: (projectId: number, viewId: number, data?: CloneCustomViewRequest) =>
    apiFetch<CustomViewResponse>(`${base(projectId)}/${viewId}/clone`, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  reorder: (projectId: number, data: ReorderCustomViewsRequest) =>
    apiFetch<void>(`${base(projectId)}/reorder`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  setDefault: (projectId: number, viewId: number) =>
    apiFetch<CustomViewResponse>(`${base(projectId)}/${viewId}/default`, {
      method: 'PUT',
    }),
}

// 重导出 query keys，方便 hooks 单路径导入
export { customViewsKeys } from './custom-views-query-keys'
