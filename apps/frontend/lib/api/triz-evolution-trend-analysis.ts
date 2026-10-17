import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreateEvolutionTrendAnalysisRequest,
  CreateEvolutionTrendAnalysisResponse,
  ListEvolutionTrendAnalysesResponse,
  EvolutionTrendAnalysisDetailResponse,
  ListEvolutionTrendScoresResponse,
  ListEvolutionTrendRisksResponse,
  EvolutionTrendHistoryResponse,
  ExplainEvolutionTrendRiskResponse,
  ReviewEvolutionTrendRiskRequest,
  ReviewEvolutionTrendRiskResponse,
  EvolutionTrendHandoffPreviewRequest,
  EvolutionTrendHandoffPreviewResponse,
} from '@aiproj/types'

export interface ListEvolutionTrendAnalysesParams {
  page?: number
  perPage?: number
  status?: string
  scopeType?: string
  sort?: string
}

export interface ListEvolutionTrendScoresParams {
  page?: number
  perPage?: number
  trendId?: string
  severity?: string
  sort?: string
}

export interface ListEvolutionTrendRisksParams {
  page?: number
  perPage?: number
  status?: string
  riskType?: string
  trendId?: string
  severity?: string
  stale?: boolean
  sort?: string
}

export interface EvolutionTrendHistoryParams {
  baselineRunId?: number
}

const path = (projectId: number) => `/projects/${projectId}/triz/evolution-trend-analyses`

function query(params?: Record<string, unknown>): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v))
    }
  }
  return search.size ? `?${search.toString()}` : ''
}

export const evolutionTrendApi = {
  create(projectId: number, body?: CreateEvolutionTrendAnalysisRequest) {
    return apiFetchEnvelope<CreateEvolutionTrendAnalysisResponse>(path(projectId), {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }).then((res) => res.data)
  },

  list(projectId: number, params?: ListEvolutionTrendAnalysesParams) {
    return apiFetchEnvelope<ListEvolutionTrendAnalysesResponse>(
      `${path(projectId)}${query(params as Record<string, unknown>)}`,
    )
  },

  get(projectId: number, runId: number) {
    return apiFetchEnvelope<EvolutionTrendAnalysisDetailResponse>(
      `${path(projectId)}/${runId}`,
    ).then((res) => res.data)
  },

  listTrends(projectId: number, runId: number, params?: ListEvolutionTrendScoresParams) {
    return apiFetchEnvelope<ListEvolutionTrendScoresResponse>(
      `${path(projectId)}/${runId}/trends${query(params as Record<string, unknown>)}`,
    )
  },

  listRisks(projectId: number, runId: number, params?: ListEvolutionTrendRisksParams) {
    return apiFetchEnvelope<ListEvolutionTrendRisksResponse>(
      `${path(projectId)}/${runId}/risks${query(params as Record<string, unknown>)}`,
    )
  },

  history(projectId: number, runId: number, params?: EvolutionTrendHistoryParams) {
    return apiFetchEnvelope<EvolutionTrendHistoryResponse>(
      `${path(projectId)}/${runId}/history${query(params as Record<string, unknown>)}`,
    ).then((res) => res.data)
  },

  explain(projectId: number, runId: number, riskId: number) {
    return apiFetchEnvelope<ExplainEvolutionTrendRiskResponse>(
      `${path(projectId)}/${runId}/risks/${riskId}/explain`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  review(projectId: number, runId: number, riskId: number, body: ReviewEvolutionTrendRiskRequest) {
    return apiFetchEnvelope<ReviewEvolutionTrendRiskResponse>(
      `${path(projectId)}/${runId}/risks/${riskId}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((res) => res.data)
  },

  workbenchPreview(
    projectId: number,
    runId: number,
    riskId: number,
    body?: EvolutionTrendHandoffPreviewRequest,
  ) {
    return apiFetchEnvelope<EvolutionTrendHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/risks/${riskId}/workbench-preview`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
    ).then((res) => res.data)
  },

  decisionPreview(
    projectId: number,
    runId: number,
    riskId: number,
    body?: EvolutionTrendHandoffPreviewRequest,
  ) {
    return apiFetchEnvelope<EvolutionTrendHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/risks/${riskId}/decision-preview`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
    ).then((res) => res.data)
  },

  draftPreview(
    projectId: number,
    runId: number,
    riskId: number,
    body?: EvolutionTrendHandoffPreviewRequest,
  ) {
    return apiFetchEnvelope<EvolutionTrendHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/risks/${riskId}/draft-preview`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
    ).then((res) => res.data)
  },

  riskPreview(
    projectId: number,
    runId: number,
    riskId: number,
    body?: EvolutionTrendHandoffPreviewRequest,
  ) {
    return apiFetchEnvelope<EvolutionTrendHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/risks/${riskId}/risk-preview`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
    ).then((res) => res.data)
  },
}

export const evolutionTrendKeys = {
  all: ['triz-evolution-trend-analysis'] as const,
  list: (projectId: number, params?: ListEvolutionTrendAnalysesParams) =>
    [...evolutionTrendKeys.all, 'runs', projectId, params ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...evolutionTrendKeys.all, 'run', projectId, runId] as const,
  trends: (projectId: number, runId: number, params?: ListEvolutionTrendScoresParams) =>
    [...evolutionTrendKeys.all, 'trends', projectId, runId, params ?? {}] as const,
  risks: (projectId: number, runId: number, params?: ListEvolutionTrendRisksParams) =>
    [...evolutionTrendKeys.all, 'risks', projectId, runId, params ?? {}] as const,
  history: (projectId: number, runId: number, params?: EvolutionTrendHistoryParams) =>
    [...evolutionTrendKeys.all, 'history', projectId, runId, params ?? {}] as const,
}
