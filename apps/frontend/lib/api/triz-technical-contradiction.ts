import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreateTechnicalAnalysisRequest,
  CreateTechnicalAnalysisResponse,
  ListTechnicalAnalysesResponse,
  TechnicalAnalysisDetailResponse,
  ListTechnicalCandidatesResponse,
  ExplainTechnicalCandidateResponse,
  ReviewTechnicalCandidateRequest,
  ReviewTechnicalCandidateResponse,
  ConfirmationPreviewResponse,
  HandoffPreviewResponse,
} from '@aiproj/types'

export interface ListTechnicalAnalysesParams {
  page?: number
  perPage?: number
  status?: string
  sort?: string
}

export interface ListTechnicalCandidatesParams {
  page?: number
  perPage?: number
  status?: string
  severity?: string
  stale?: boolean
  sort?: string
}

const path = (projectId: number) => `/projects/${projectId}/triz/technical-contradiction-analyses`

function query(params?: Record<string, unknown>): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v))
    }
  }
  return search.size ? `?${search.toString()}` : ''
}

export const technicalContradictionApi = {
  create(projectId: number, body?: CreateTechnicalAnalysisRequest) {
    return apiFetchEnvelope<CreateTechnicalAnalysisResponse>(path(projectId), {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }).then((res) => res.data)
  },

  list(projectId: number, params?: ListTechnicalAnalysesParams) {
    return apiFetchEnvelope<ListTechnicalAnalysesResponse>(
      `${path(projectId)}${query(params as Record<string, unknown>)}`,
    )
  },

  get(projectId: number, runId: number) {
    return apiFetchEnvelope<TechnicalAnalysisDetailResponse>(`${path(projectId)}/${runId}`).then(
      (res) => res.data,
    )
  },

  listCandidates(projectId: number, runId: number, params?: ListTechnicalCandidatesParams) {
    return apiFetchEnvelope<ListTechnicalCandidatesResponse>(
      `${path(projectId)}/${runId}/candidates${query(params as Record<string, unknown>)}`,
    )
  },

  explain(projectId: number, runId: number, candidateKey: string) {
    return apiFetchEnvelope<ExplainTechnicalCandidateResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/explain`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  review(
    projectId: number,
    runId: number,
    candidateKey: string,
    body: ReviewTechnicalCandidateRequest,
  ) {
    return apiFetchEnvelope<ReviewTechnicalCandidateResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((res) => res.data)
  },

  confirmationPreview(projectId: number, runId: number, candidateKey: string) {
    return apiFetchEnvelope<ConfirmationPreviewResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/confirmation-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  handoffPreview(projectId: number, runId: number, candidateKey: string, targetType: string) {
    return apiFetchEnvelope<HandoffPreviewResponse>(
      `${path(projectId)}/${runId}/candidates/${candidateKey}/handoff-preview`,
      { method: 'POST', body: JSON.stringify({ targetType }) },
    ).then((res) => res.data)
  },
}

export const technicalContradictionKeys = {
  all: ['triz-technical-contradiction'] as const,
  list: (projectId: number, params?: ListTechnicalAnalysesParams) =>
    [...technicalContradictionKeys.all, 'runs', projectId, params ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...technicalContradictionKeys.all, 'run', projectId, runId] as const,
  candidates: (projectId: number, runId: number, params?: ListTechnicalCandidatesParams) =>
    [...technicalContradictionKeys.all, 'candidates', projectId, runId, params ?? {}] as const,
}
