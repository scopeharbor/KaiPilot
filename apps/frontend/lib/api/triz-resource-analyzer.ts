import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreateResourceAnalysisRequest,
  CreateResourceAnalysisResponse,
  ListResourceAnalysesResponse,
  ResourceAnalysisDetailResponse,
  ListResourceSnapshotsResponse,
  ListResourceOpportunitiesResponse,
  ExplainResourceOpportunityResponse,
  ReviewResourceOpportunityRequest,
  ReviewResourceOpportunityResponse,
  ResourceOpportunityConfirmationPreviewResponse,
  ResourceOpportunityHandoffPreviewResponse,
} from '@aiproj/types'

export interface ListResourceAnalysesParams {
  page?: number
  perPage?: number
  status?: string
  sort?: string
}

export interface ListResourceSnapshotsParams {
  page?: number
  perPage?: number
  resourceKind?: string
  systemScope?: string
  origin?: string
  sort?: string
}

export interface ListResourceOpportunitiesParams {
  page?: number
  perPage?: number
  status?: string
  opportunityType?: string
  severity?: string
  stale?: boolean
  sort?: string
}

const path = (projectId: number) => `/projects/${projectId}/triz/resource-analyses`

function query(params?: Record<string, unknown>): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v))
    }
  }
  return search.size ? `?${search.toString()}` : ''
}

export const resourceAnalyzerApi = {
  create(projectId: number, body?: CreateResourceAnalysisRequest) {
    return apiFetchEnvelope<CreateResourceAnalysisResponse>(path(projectId), {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }).then((res) => res.data)
  },

  list(projectId: number, params?: ListResourceAnalysesParams) {
    return apiFetchEnvelope<ListResourceAnalysesResponse>(
      `${path(projectId)}${query(params as Record<string, unknown>)}`,
    )
  },

  get(projectId: number, runId: number) {
    return apiFetchEnvelope<ResourceAnalysisDetailResponse>(`${path(projectId)}/${runId}`).then(
      (res) => res.data,
    )
  },

  listResources(projectId: number, runId: number, params?: ListResourceSnapshotsParams) {
    return apiFetchEnvelope<ListResourceSnapshotsResponse>(
      `${path(projectId)}/${runId}/resources${query(params as Record<string, unknown>)}`,
    )
  },

  listOpportunities(projectId: number, runId: number, params?: ListResourceOpportunitiesParams) {
    return apiFetchEnvelope<ListResourceOpportunitiesResponse>(
      `${path(projectId)}/${runId}/opportunities${query(params as Record<string, unknown>)}`,
    )
  },

  explain(projectId: number, runId: number, opportunityId: number) {
    return apiFetchEnvelope<ExplainResourceOpportunityResponse>(
      `${path(projectId)}/${runId}/opportunities/${opportunityId}/explain`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  review(
    projectId: number,
    runId: number,
    opportunityId: number,
    body: ReviewResourceOpportunityRequest,
  ) {
    return apiFetchEnvelope<ReviewResourceOpportunityResponse>(
      `${path(projectId)}/${runId}/opportunities/${opportunityId}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((res) => res.data)
  },

  workbenchPreview(projectId: number, runId: number, opportunityId: number) {
    return apiFetchEnvelope<ResourceOpportunityConfirmationPreviewResponse>(
      `${path(projectId)}/${runId}/opportunities/${opportunityId}/workbench-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  decisionPreview(projectId: number, runId: number, opportunityId: number) {
    return apiFetchEnvelope<ResourceOpportunityConfirmationPreviewResponse>(
      `${path(projectId)}/${runId}/opportunities/${opportunityId}/decision-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  draftPreview(projectId: number, runId: number, opportunityId: number) {
    return apiFetchEnvelope<ResourceOpportunityHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/opportunities/${opportunityId}/draft-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  resourcePreview(projectId: number, runId: number, opportunityId: number) {
    return apiFetchEnvelope<ResourceOpportunityHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/opportunities/${opportunityId}/resource-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },
}

export const resourceAnalyzerKeys = {
  all: ['triz-resource-analyzer'] as const,
  list: (projectId: number, params?: ListResourceAnalysesParams) =>
    [...resourceAnalyzerKeys.all, 'runs', projectId, params ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...resourceAnalyzerKeys.all, 'run', projectId, runId] as const,
  resources: (projectId: number, runId: number, params?: ListResourceSnapshotsParams) =>
    [...resourceAnalyzerKeys.all, 'resources', projectId, runId, params ?? {}] as const,
  opportunities: (projectId: number, runId: number, params?: ListResourceOpportunitiesParams) =>
    [...resourceAnalyzerKeys.all, 'opportunities', projectId, runId, params ?? {}] as const,
}
