import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  ContradictionAiExplanation,
  ContradictionDTO,
  ListContradictionsResponse,
  RefreshContradictionsResponse,
} from '@aiproj/types'

export type {
  ContradictionAiExplanation,
  ContradictionDashboardSummary,
  ContradictionDTO,
  ContradictionSeverity,
  ContradictionStatus,
  ContradictionType,
} from '@aiproj/types'

export interface ListContradictionsParams {
  page?: number
  perPage?: number
  type?: string
  status?: string
  severity?: string
  sort?: string
}

const path = (projectId: number) => `/projects/${projectId}/contradictions`

function query(params?: ListContradictionsParams): string {
  const search = new URLSearchParams()
  if (params?.page) search.set('page', String(params.page))
  if (params?.perPage) search.set('perPage', String(params.perPage))
  if (params?.type) search.set('type', params.type)
  if (params?.status) search.set('status', params.status)
  if (params?.severity) search.set('severity', params.severity)
  if (params?.sort) search.set('sort', params.sort)
  return search.size ? `?${search.toString()}` : ''
}

export const trizContradictionsApi = {
  list(projectId: number, params?: ListContradictionsParams) {
    return apiFetchEnvelope<ListContradictionsResponse>(`${path(projectId)}${query(params)}`)
  },
  get(projectId: number, contradictionId: number) {
    return apiFetchEnvelope<{ data: ContradictionDTO }>(
      `${path(projectId)}/${contradictionId}`,
    ).then((res) => res.data)
  },
  refresh(projectId: number) {
    return apiFetchEnvelope<RefreshContradictionsResponse>(`${path(projectId)}/refresh`, {
      method: 'POST',
    }).then((res) => res.data)
  },
  confirm(projectId: number, contradictionId: number) {
    return apiFetchEnvelope<{ data: ContradictionDTO }>(
      `${path(projectId)}/${contradictionId}/confirm`,
      { method: 'POST' },
    ).then((res) => res.data)
  },
  dismiss(projectId: number, contradictionId: number, reason: string) {
    return apiFetchEnvelope<{ data: ContradictionDTO }>(
      `${path(projectId)}/${contradictionId}/dismiss`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
    ).then((res) => res.data)
  },
  explain(projectId: number, contradictionId: number, focus?: string) {
    return apiFetchEnvelope<{ data: ContradictionAiExplanation }>(
      `${path(projectId)}/${contradictionId}/explain`,
      {
        method: 'POST',
        body: JSON.stringify({ focus }),
      },
    ).then((res) => res.data)
  },
}

export const trizContradictionKeys = {
  all: ['triz-contradictions'] as const,
  list: (projectId: number, params?: ListContradictionsParams) =>
    [...trizContradictionKeys.all, 'list', projectId, params ?? {}] as const,
  detail: (projectId: number, contradictionId: number) =>
    [...trizContradictionKeys.all, 'detail', projectId, contradictionId] as const,
  dashboard: (projectId: number) => [...trizContradictionKeys.all, 'dashboard', projectId] as const,
}

export type { ListContradictionsResponse, RefreshContradictionsResponse }
