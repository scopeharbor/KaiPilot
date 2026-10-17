import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreatePhysicalAnalysisRequest,
  CreatePhysicalAnalysisResponse,
  ListPhysicalAnalysesResponse,
  PhysicalAnalysisDetailResponse,
  ListPhysicalCandidatesResponse,
  ExplainPhysicalCandidateResponse,
  ReviewPhysicalCandidateRequest,
  ReviewPhysicalCandidateResponse,
  PhysicalConfirmationPreviewResponse,
  PhysicalHandoffPreviewResponse,
} from '@aiproj/types'

export interface ListPhysicalAnalysesParams {
  page?: number
  perPage?: number
  status?: string
  sort?: string
}

export interface ListPhysicalCandidatesParams {
  page?: number
  perPage?: number
  status?: string
  severity?: string
  separationAxis?: string
  stale?: boolean
  sort?: string
}

const path = (projectId: number) => `/projects/${projectId}/triz/physical-contradiction-analyses`

function query(params?: Record<string, unknown>): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v))
    }
  }
  return search.size ? `?${search.toString()}` : ''
}

export const physicalContradictionApi = {
  create(projectId: number, body?: CreatePhysicalAnalysisRequest) {
    return apiFetchEnvelope<CreatePhysicalAnalysisResponse>(path(projectId), {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }).then((res) => res.data)
  },

  list(projectId: number, params?: ListPhysicalAnalysesParams) {
    return apiFetchEnvelope<ListPhysicalAnalysesResponse>(
      `${path(projectId)}${query(params as Record<string, unknown>)}`,
    )
  },

  get(projectId: number, runId: number) {
    return apiFetchEnvelope<PhysicalAnalysisDetailResponse>(`${path(projectId)}/${runId}`).then(
      (res) => res.data,
    )
  },

  listCandidates(projectId: number, runId: number, params?: ListPhysicalCandidatesParams) {
    return apiFetchEnvelope<ListPhysicalCandidatesResponse>(
      `${path(projectId)}/${runId}/candidates${query(params as Record<string, unknown>)}`,
    )
  },

  explain(projectId: number, runId: number, candidateKey: string) {
    return apiFetchEnvelope<ExplainPhysicalCandidateResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/explain`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  review(
    projectId: number,
    runId: number,
    candidateKey: string,
    body: ReviewPhysicalCandidateRequest,
  ) {
    return apiFetchEnvelope<ReviewPhysicalCandidateResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((res) => res.data)
  },

  confirmationPreview(projectId: number, runId: number, candidateKey: string) {
    return apiFetchEnvelope<PhysicalConfirmationPreviewResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/confirmation-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  handoffPreview(projectId: number, runId: number, candidateKey: string, targetType: string) {
    return apiFetchEnvelope<PhysicalHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/handoff-preview`,
      { method: 'POST', body: JSON.stringify({ targetType }) },
    ).then((res) => res.data)
  },
}

export const physicalContradictionKeys = {
  all: ['triz-physical-contradiction'] as const,
  list: (projectId: number, params?: ListPhysicalAnalysesParams) =>
    [...physicalContradictionKeys.all, 'runs', projectId, params ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...physicalContradictionKeys.all, 'run', projectId, runId] as const,
  candidates: (projectId: number, runId: number, params?: ListPhysicalCandidatesParams) =>
    [...physicalContradictionKeys.all, 'candidates', projectId, runId, params ?? {}] as const,
}
