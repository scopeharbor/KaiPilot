// 跨项目资源调配 API client（v3-cross-project-resource-allocation §6.1）。
// TanStack Query keys + API fetch helpers。
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  CrossProjectAllocationDraft,
  CrossProjectAllocationDraftDetail,
  CrossProjectAllocationListResponse,
  CrossProjectAllocationCandidatesResponse,
  CrossProjectAllocationPreview,
  CrossProjectAllocationConfirmation,
  CrossProjectAllocationApplyResult,
  CrossProjectAllocationDraftItem,
  CrossProjectAllocationConflict,
  CrossProjectAllocationDrillDownResponse,
} from '@aiproj/types'

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        query.set(key, value.join(','))
      } else {
        query.set(key, String(value))
      }
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

const basePath = (organizationId: number) =>
  `/organizations/${organizationId}/cross-project-resource-allocations`

export const crossProjectAllocationKeys = {
  all: (organizationId: number) => ['cross-project-allocations', organizationId] as const,

  drafts: (organizationId: number, query?: Record<string, unknown>) =>
    [...crossProjectAllocationKeys.all(organizationId), 'drafts', query] as const,

  draft: (organizationId: number, draftId: number) =>
    [...crossProjectAllocationKeys.all(organizationId), 'draft', draftId] as const,

  candidates: (organizationId: number, query?: Record<string, unknown>) =>
    [...crossProjectAllocationKeys.all(organizationId), 'candidates', query] as const,
}

// 单键 `{data: X}` 端点用 `apiFetch<X>`（apiFetch 已解一层，调用方直接消费 X）；
// 分页端点用 `apiFetchEnvelope`（保 data + meta 信封）。
export const crossProjectAllocationApi = {
  // ── 草案 ──
  // 后端 controller `{data: DraftDTO}`，解包后即草案实体。
  createDraft: (organizationId: number, body: Record<string, unknown>) =>
    apiFetch<CrossProjectAllocationDraft>(`${basePath(organizationId)}/drafts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // 后端 controller 直接返回 service 的 `{data, meta}`，信封必须保真。
  listDrafts: (organizationId: number, query: Record<string, unknown> = {}) =>
    apiFetchEnvelope<CrossProjectAllocationListResponse>(
      `${basePath(organizationId)}/drafts${buildQuery(query)}`,
    ),

  getDraft: (organizationId: number, draftId: number) =>
    apiFetch<CrossProjectAllocationDraftDetail>(`${basePath(organizationId)}/drafts/${draftId}`),

  updateItems: (organizationId: number, draftId: number, body: Record<string, unknown>) =>
    apiFetch<CrossProjectAllocationDraftItem[]>(
      `${basePath(organizationId)}/drafts/${draftId}/items`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  // ── 候选 ──
  // 同 listDrafts：后端返回 `{data, meta}` 信封。
  listCandidates: (organizationId: number, query: Record<string, unknown> = {}) =>
    apiFetchEnvelope<CrossProjectAllocationCandidatesResponse>(
      `${basePath(organizationId)}/candidates${buildQuery(query)}`,
    ),

  // ── 预览 / 确认 / 应用 / 取消 ──
  previewDraft: (organizationId: number, draftId: number) =>
    apiFetch<CrossProjectAllocationPreview>(
      `${basePath(organizationId)}/drafts/${draftId}/preview`,
      { method: 'POST' },
    ),

  confirmDraft: (organizationId: number, draftId: number, body: Record<string, unknown>) =>
    apiFetch<CrossProjectAllocationConfirmation>(
      `${basePath(organizationId)}/drafts/${draftId}/confirm`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  applyDraft: (organizationId: number, draftId: number, body: Record<string, unknown>) =>
    apiFetch<CrossProjectAllocationApplyResult>(
      `${basePath(organizationId)}/drafts/${draftId}/apply`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  cancelDraft: (organizationId: number, draftId: number) =>
    apiFetch<CrossProjectAllocationDraft>(`${basePath(organizationId)}/drafts/${draftId}/cancel`, {
      method: 'POST',
    }),

  // ── 冲突 ──
  listConflicts: (organizationId: number, draftId: number, query: Record<string, unknown> = {}) =>
    apiFetch<CrossProjectAllocationConflict[]>(
      `${basePath(organizationId)}/drafts/${draftId}/conflicts${buildQuery(query)}`,
    ),

  // ── 下钻 ──
  drillDown: (organizationId: number, query: Record<string, unknown>) =>
    apiFetch<CrossProjectAllocationDrillDownResponse>(
      `${basePath(organizationId)}/drill-down${buildQuery(query)}`,
    ),
}
