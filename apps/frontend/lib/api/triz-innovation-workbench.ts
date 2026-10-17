import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  AddOptionRequest,
  CreateInnovationSchemeRequest,
  InnovationDraftHandoffInput,
  InnovationHandoffStatus,
  InnovationReviewState,
  InnovationSchemeComparison,
  InnovationSchemeDTO,
  InnovationSchemeStatus,
  InnovationWorkbenchSourcesResponse,
  ListInnovationSchemesResponse,
  InnovationSchemeNarrative,
} from '@aiproj/types'

/**
 * v3-triz-innovation-workbench —— 前端 API 客户端。
 *
 * 读取接口只取已存在 refs/summary；comparison、narrative、handoff 必须由显式 mutation 触发。
 */

export const trizInnovationKeys = {
  all: ['triz-innovation-workbench'] as const,
  sources: (projectId: number, includeDraft = false) =>
    [...trizInnovationKeys.all, 'sources', projectId, includeDraft] as const,
  schemes: (
    projectId: number,
    filters: { page?: number; perPage?: number; status?: InnovationSchemeStatus } = {},
  ) => [...trizInnovationKeys.all, 'schemes', projectId, filters] as const,
  detail: (projectId: number, schemeId: string) =>
    [...trizInnovationKeys.all, 'scheme', projectId, schemeId] as const,
}

const basePath = (projectId: number) => `/projects/${projectId}/triz-workbench`
const schemePath = (projectId: number, schemeId: string) =>
  `${basePath(projectId)}/schemes/${schemeId}`

function querySuffix(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value))
  }
  return qs.size > 0 ? `?${qs.toString()}` : ''
}

export interface UpdateInnovationSchemeRequest {
  name?: string
  note?: string | null
  reviewState?: InnovationReviewState
}

export interface InnovationHandoffRequest {
  optionIds?: string[]
  note?: string | null
}

export interface InnovationHandoffResponse {
  handoffStatus: InnovationHandoffStatus
  draftSessionRef: string | null
  blockedReason: string | null
  candidate: InnovationDraftHandoffInput | null
}

export interface InnovationComparisonMutationResponse {
  scheme: InnovationSchemeDTO
  comparison: InnovationSchemeComparison
}

export interface InnovationNarrativeMutationResponse extends InnovationComparisonMutationResponse {
  narrative: InnovationSchemeNarrative
}

export const trizInnovationApi = {
  sources: (projectId: number, params: { includeDraft?: boolean } = {}) =>
    apiFetchEnvelope<InnovationWorkbenchSourcesResponse>(
      `${basePath(projectId)}/sources${querySuffix({ includeDraft: params.includeDraft })}`,
    ).then((res) => res.data),

  listSchemes: (
    projectId: number,
    params: { page?: number; perPage?: number; status?: InnovationSchemeStatus } = {},
  ) =>
    apiFetchEnvelope<ListInnovationSchemesResponse>(
      `${basePath(projectId)}/schemes${querySuffix(params)}`,
    ),

  detail: (projectId: number, schemeId: string) =>
    apiFetchEnvelope<{ data: InnovationSchemeDTO }>(schemePath(projectId, schemeId)).then(
      (res) => res.data,
    ),

  createScheme: (projectId: number, payload: CreateInnovationSchemeRequest) =>
    apiFetchEnvelope<{ data: InnovationSchemeDTO }>(`${basePath(projectId)}/schemes`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),

  updateScheme: (projectId: number, schemeId: string, payload: UpdateInnovationSchemeRequest) =>
    apiFetchEnvelope<{ data: InnovationSchemeDTO }>(schemePath(projectId, schemeId), {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),

  abandonScheme: (projectId: number, schemeId: string) =>
    apiFetchEnvelope<{ data: InnovationSchemeDTO }>(`${schemePath(projectId, schemeId)}/abandon`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),

  addOption: (projectId: number, schemeId: string, payload: AddOptionRequest) =>
    apiFetchEnvelope<{ data: InnovationSchemeDTO }>(`${schemePath(projectId, schemeId)}/options`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),

  removeOption: (projectId: number, schemeId: string, optionId: string) =>
    apiFetchEnvelope<{ data: InnovationSchemeDTO }>(
      `${schemePath(projectId, schemeId)}/options/${optionId}`,
      { method: 'DELETE' },
    ).then((res) => res.data),

  compare: (projectId: number, schemeId: string) =>
    apiFetchEnvelope<{ data: InnovationComparisonMutationResponse }>(
      `${schemePath(projectId, schemeId)}/comparison`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),

  narrative: (projectId: number, schemeId: string) =>
    apiFetchEnvelope<{ data: InnovationNarrativeMutationResponse }>(
      `${schemePath(projectId, schemeId)}/narrative`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),

  draftHandoff: (projectId: number, schemeId: string, payload: InnovationHandoffRequest = {}) =>
    apiFetchEnvelope<{ data: InnovationHandoffResponse }>(
      `${schemePath(projectId, schemeId)}/draft-handoff`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),
}

export default trizInnovationApi
