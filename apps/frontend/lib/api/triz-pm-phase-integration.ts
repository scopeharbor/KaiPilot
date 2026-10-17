import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreatePhaseIntegrationRunResponse,
  ListPhaseIntegrationRunsResponse,
  GetPhaseIntegrationRunResponse,
  ListPhasesResponse,
  GetPhaseDetailResponse,
  ReviewPhaseRequest,
  ReviewPhaseResponse,
  ExplainPhaseRequest,
  ExplainPhaseResponse,
  PmPhaseHandoffPreviewRequest,
  PmPhaseHandoffPreviewResponse,
} from '@aiproj/types'

export interface ListPmPhaseIntegrationRunsParams {
  page?: number
  perPage?: number
  status?: string
  sort?: string
}

const path = (projectId: number) => `/projects/${projectId}/triz/pm-phase-integration`

function query(params?: Record<string, unknown>): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v))
    }
  }
  return search.size ? `?${search.toString()}` : ''
}

export const pmPhaseIntegrationApi = {
  create(projectId: number, body?: { userNotes?: string }) {
    return apiFetchEnvelope<CreatePhaseIntegrationRunResponse>(path(projectId), {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }).then((res) => res.data)
  },

  list(projectId: number, params?: ListPmPhaseIntegrationRunsParams) {
    return apiFetchEnvelope<ListPhaseIntegrationRunsResponse>(
      `${path(projectId)}${query(params as Record<string, unknown>)}`,
    )
  },

  get(projectId: number, runId: number) {
    return apiFetchEnvelope<GetPhaseIntegrationRunResponse>(`${path(projectId)}/${runId}`).then(
      (res) => res.data,
    )
  },

  listPhases(projectId: number, runId: number) {
    return apiFetchEnvelope<ListPhasesResponse>(`${path(projectId)}/${runId}/phases`)
  },

  getPhase(projectId: number, runId: number, phaseId: string) {
    return apiFetchEnvelope<GetPhaseDetailResponse>(
      `${path(projectId)}/${runId}/phases/${phaseId}`,
    ).then((res) => res.data)
  },

  review(projectId: number, runId: number, body: ReviewPhaseRequest) {
    return apiFetchEnvelope<ReviewPhaseResponse>(`${path(projectId)}/${runId}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((res) => res.data)
  },

  explain(projectId: number, runId: number, body: ExplainPhaseRequest) {
    return apiFetchEnvelope<ExplainPhaseResponse>(`${path(projectId)}/${runId}/explain`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((res) => res.data)
  },

  handoffPreview(projectId: number, runId: number, body: PmPhaseHandoffPreviewRequest) {
    return apiFetchEnvelope<PmPhaseHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/handoff-preview`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((res) => res.data)
  },
}

export const pmPhaseIntegrationKeys = {
  all: ['triz-pm-phase-integration'] as const,
  list: (projectId: number, params?: ListPmPhaseIntegrationRunsParams) =>
    [...pmPhaseIntegrationKeys.all, 'runs', projectId, params ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...pmPhaseIntegrationKeys.all, 'run', projectId, runId] as const,
  phases: (projectId: number, runId: number) =>
    [...pmPhaseIntegrationKeys.all, 'phases', projectId, runId] as const,
  phase: (projectId: number, runId: number, phaseId: string) =>
    [...pmPhaseIntegrationKeys.all, 'phase', projectId, runId, phaseId] as const,
}
