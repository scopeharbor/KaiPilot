// 跨项目依赖 CRUD API client（v3-multi-project-dependency-crud §8.1）。
// TanStack Query keys + API fetch helpers。
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  DepListFilters,
  DepListResponse,
  DepDetail,
  DepCreatePreviewInput,
  DepUpdatePreviewInput,
  DepPreviewSnapshot,
  DepConfirmRequest,
  DepConfirmResult,
  MultiProjectGraphQuery,
  MultiProjectGraphResponse,
} from '@aiproj/types'

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        // 重复键序列化：HTTP 层 qs 的 comma:true 会把多值逗号串拆成数组（200），
        // 真正被 vine 拒成 422 的是单元素退化成裸值；故数组一律重复键（design §4.3.1）
        for (const v of value) query.append(key, String(v))
      } else {
        query.set(key, String(value))
      }
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

const basePath = (organizationId: number | string) =>
  `/organizations/${organizationId}/multi-project-dependencies`

export const mpdKeys = {
  all: (organizationId: number | string) => ['multi-project-dependencies', organizationId] as const,

  list: (organizationId: number | string, filters?: DepListFilters) =>
    [...mpdKeys.all(organizationId), 'list', filters ?? {}] as const,

  detail: (organizationId: number | string, depId: string) =>
    [...mpdKeys.all(organizationId), 'detail', depId] as const,

  graph: (organizationId: number | string, query?: MultiProjectGraphQuery) =>
    [...mpdKeys.all(organizationId), 'graph', query ?? {}] as const,
}

export const mpdApi = {
  // ── 列表 ──
  list: (organizationId: number | string, filters?: DepListFilters) =>
    apiFetchEnvelope<DepListResponse>(
      `${basePath(organizationId)}${buildQuery(filters as Record<string, unknown>)}`,
    ),

  // ── 详情 ──
  detail: (organizationId: number | string, depId: string) =>
    apiFetch<DepDetail>(`${basePath(organizationId)}/${depId}`),

  // ── 创建预览 ──
  previewCreate: (organizationId: number | string, body: DepCreatePreviewInput) =>
    apiFetch<DepPreviewSnapshot>(`${basePath(organizationId)}/preview-create`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 确认创建 ──
  confirmCreate: (organizationId: number | string, body: DepConfirmRequest) =>
    apiFetch<DepConfirmResult>(`${basePath(organizationId)}/confirm-create`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 更新预览 ──
  previewUpdate: (organizationId: number | string, body: DepUpdatePreviewInput) =>
    apiFetch<DepPreviewSnapshot>(`${basePath(organizationId)}/preview-update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 确认更新 ──
  confirmUpdate: (organizationId: number | string, body: DepConfirmRequest) =>
    apiFetch<DepConfirmResult>(`${basePath(organizationId)}/confirm-update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 归档预览 ──
  // depId 在 UI 边界保持 string，按后端 validator 转成 { dependencyId: number }（design §4.4）
  previewArchive: (organizationId: number | string, depId: string) =>
    apiFetch<DepPreviewSnapshot>(`${basePath(organizationId)}/preview-archive`, {
      method: 'POST',
      body: JSON.stringify({ dependencyId: Number(depId) }),
    }),

  // ── 确认归档 ──
  confirmArchive: (organizationId: number | string, body: DepConfirmRequest) =>
    apiFetch<DepConfirmResult>(`${basePath(organizationId)}/confirm-archive`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 恢复预览 ──
  previewRestore: (organizationId: number | string, depId: string) =>
    apiFetch<DepPreviewSnapshot>(`${basePath(organizationId)}/preview-restore`, {
      method: 'POST',
      body: JSON.stringify({ dependencyId: Number(depId) }),
    }),

  // ── 确认恢复 ──
  confirmRestore: (organizationId: number | string, body: DepConfirmRequest) =>
    apiFetch<DepConfirmResult>(`${basePath(organizationId)}/confirm-restore`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 删除预览 ──
  previewDelete: (organizationId: number | string, depId: string) =>
    apiFetch<DepPreviewSnapshot>(`${basePath(organizationId)}/preview-delete`, {
      method: 'POST',
      body: JSON.stringify({ dependencyId: Number(depId) }),
    }),

  // ── 确认删除 ──
  confirmDelete: (organizationId: number | string, body: DepConfirmRequest) =>
    apiFetch<DepConfirmResult>(`${basePath(organizationId)}/confirm-delete`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 图谱 ──
  // 后端 graph handler 只返 { data: result }，功能关闭由 mpdCrudFeatureGuard 的 503 承担，
  // 业务错误走统一错误信封——不再声明 GraphResponseEnvelope 的 featureDisabled/error 分支。
  graph: (organizationId: number | string, query: MultiProjectGraphQuery) =>
    apiFetch<MultiProjectGraphResponse>(
      `${basePath(organizationId)}/graph${buildGraphQuery(query)}`,
    ),
}

/**
 * 将图谱查询参数序列化为 URL query string。
 */
function buildGraphQuery(query: MultiProjectGraphQuery): string {
  const params = new URLSearchParams()
  if (query.projectIds.length > 0) {
    // 重复键序列化（同 buildQuery）：qs 的 comma:true 拆多值逗号串，
    // 单元素退化成裸值才被 vine 拒 422（design §4.3.1）
    for (const id of query.projectIds) params.append('projectIds', String(id))
  }
  if (query.endpointType) params.set('endpointType', query.endpointType)
  if (query.category) params.set('category', query.category)
  if (query.status?.length) {
    for (const status of query.status) params.append('status', String(status))
  }
  if (query.riskLevel) params.set('riskLevel', query.riskLevel)
  if (query.maxDepth) params.set('maxDepth', String(query.maxDepth))
  if (query.nodeLimit) params.set('nodeLimit', String(query.nodeLimit))
  if (query.edgeLimit) params.set('edgeLimit', String(query.edgeLimit))
  if (query.freshnessThreshold && query.freshnessThreshold !== 'all') {
    params.set('freshnessThreshold', query.freshnessThreshold)
  }
  return params.size ? `?${params.toString()}` : ''
}
