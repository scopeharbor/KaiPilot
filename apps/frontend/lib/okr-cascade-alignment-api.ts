// OKR 级联与对齐 API 客户端
// v3-okr-cascade-and-alignment Section 5

import type {
  OkrCascadePlanCreateRequest,
  OkrCascadePlanItemConfirmRequest,
  OkrCascadePlanItemRejectRequest,
  OkrRelationCreateRequest,
  OkrRelationUpdateRequest,
  OkrHealthQuery,
  OkrAlignmentMatrixQuery,
  OkrAiCascadeSuggestionRequest,
  OkrCascadePlanResponse,
  OkrCascadePlanListResponse,
  OkrCascadePlanDetailResponse,
  OkrRelationResponse,
  OkrRelationListResponse,
  OkrHealthResponse,
  OkrHealthListResponse,
  OkrAlignmentMatrixResponse,
  OkrCascadeConfirmationDiffResponse,
  OkrAiCascadeSuggestionResponse,
} from '@aiproj/types'
import { apiFetchEnvelope } from '@/lib/api-client'

/**
 * 统一走 apiFetchEnvelope：自动拼 API_BASE_URL（已含 `/api/v1`）、附带 access token、
 * 401 静默 refresh 后重放。原实现用裸 `fetch('/api/v1/...')` 打到前端自身 origin，
 * 既没有后端地址也没有认证头。
 */
function request<T>(url: string, init?: RequestInit): Promise<T> {
  return apiFetchEnvelope<T>(url, init)
}

// ── Cascade Plans ──────────────────────────────────────────────────────────

export function createCascadePlan(organizationId: number, input: OkrCascadePlanCreateRequest) {
  return request<OkrCascadePlanResponse>(`/organizations/${organizationId}/okrs/cascade-plans`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listCascadePlans(
  organizationId: number,
  params?: { status?: string; page?: number; perPage?: number },
) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.perPage) qs.set('perPage', String(params.perPage))
  const q = qs.toString()
  return request<OkrCascadePlanListResponse>(
    `/organizations/${organizationId}/okrs/cascade-plans${q ? '?' + q : ''}`,
  )
}

export function getCascadePlan(organizationId: number, planId: number) {
  return request<OkrCascadePlanDetailResponse>(
    `/organizations/${organizationId}/okrs/cascade-plans/${planId}`,
  )
}

export function confirmCascadeItems(
  organizationId: number,
  planId: number,
  input: OkrCascadePlanItemConfirmRequest,
) {
  return request<OkrCascadeConfirmationDiffResponse>(
    `/organizations/${organizationId}/okrs/cascade-plans/${planId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function rejectCascadeItems(
  organizationId: number,
  planId: number,
  input: OkrCascadePlanItemRejectRequest,
) {
  return request<{ data: { rejectedCount: number } }>(
    `/organizations/${organizationId}/okrs/cascade-plans/${planId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

// ── Cross-Objective Relations ──────────────────────────────────────────────

export function createRelation(organizationId: number, input: OkrRelationCreateRequest) {
  return request<OkrRelationResponse>(`/organizations/${organizationId}/okrs/relations`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listRelations(
  organizationId: number,
  params?: {
    sourceObjectiveId?: number
    targetObjectiveId?: number
    relationType?: string
    status?: string
    page?: number
    perPage?: number
  },
) {
  const qs = new URLSearchParams()
  if (params?.sourceObjectiveId) qs.set('sourceObjectiveId', String(params.sourceObjectiveId))
  if (params?.targetObjectiveId) qs.set('targetObjectiveId', String(params.targetObjectiveId))
  if (params?.relationType) qs.set('relationType', params.relationType)
  if (params?.status) qs.set('status', params.status)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.perPage) qs.set('perPage', String(params.perPage))
  const q = qs.toString()
  return request<OkrRelationListResponse>(
    `/organizations/${organizationId}/okrs/relations${q ? '?' + q : ''}`,
  )
}

export function getRelation(organizationId: number, relationId: number) {
  return request<OkrRelationResponse>(
    `/organizations/${organizationId}/okrs/relations/${relationId}`,
  )
}

export function updateRelation(
  organizationId: number,
  relationId: number,
  input: OkrRelationUpdateRequest,
) {
  return request<OkrRelationResponse>(
    `/organizations/${organizationId}/okrs/relations/${relationId}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

export function archiveRelation(organizationId: number, relationId: number) {
  return request<OkrRelationResponse>(
    `/organizations/${organizationId}/okrs/relations/${relationId}/archive`,
    {
      method: 'POST',
    },
  )
}

// ── Health ─────────────────────────────────────────────────────────────────

export function getHealth(organizationId: number, objectiveId: number) {
  return request<OkrHealthResponse>(
    `/organizations/${organizationId}/okrs/objectives/${objectiveId}/health`,
  )
}

export function listHealth(organizationId: number, query: OkrHealthQuery) {
  const qs = new URLSearchParams()
  if (query.cycleId) qs.set('cycleId', String(query.cycleId))
  if (query.scope) qs.set('scope', String(query.scope))
  if (query.ownerId) qs.set('ownerId', String(query.ownerId))
  if (query.status) qs.set('status', String(query.status))
  if (query.relationType) qs.set('relationType', query.relationType)
  if (query.includeRestricted) qs.set('includeRestricted', String(query.includeRestricted))
  const q = qs.toString()
  return request<OkrHealthListResponse>(
    `/organizations/${organizationId}/okrs/health${q ? '?' + q : ''}`,
  )
}

// ── Matrix ─────────────────────────────────────────────────────────────────

export function getMatrix(organizationId: number, query: OkrAlignmentMatrixQuery) {
  const qs = new URLSearchParams()
  if (query.cycleId) qs.set('cycleId', String(query.cycleId))
  if (query.scope) qs.set('scope', String(query.scope))
  if (query.ownerId) qs.set('ownerId', String(query.ownerId))
  if (query.status) qs.set('status', String(query.status))
  if (query.relationType) qs.set('relationType', query.relationType)
  if (query.healthLevel) qs.set('healthLevel', query.healthLevel)
  if (query.depth) qs.set('depth', String(query.depth))
  if (query.page) qs.set('page', String(query.page))
  if (query.perPage) qs.set('perPage', String(query.perPage))
  if (query.sort) qs.set('sort', query.sort)
  if (query.order) qs.set('order', query.order)
  const q = qs.toString()
  return request<OkrAlignmentMatrixResponse>(
    `/organizations/${organizationId}/okrs/matrix${q ? '?' + q : ''}`,
  )
}

// ── AI Cascade Suggestions ─────────────────────────────────────────────────

export function generateAiCascadeSuggestions(
  organizationId: number,
  input: OkrAiCascadeSuggestionRequest,
) {
  return request<OkrAiCascadeSuggestionResponse>(
    `/organizations/${organizationId}/okrs/ai-cascade-suggestions`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
