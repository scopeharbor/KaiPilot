import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreateFunctionAnalysisRequest,
  CreateFunctionAnalysisResponse,
  ListFunctionAnalysesResponse,
  FunctionAnalysisDetailResponse,
  FunctionAnalysisGraphResponse,
  ListFunctionIssuesResponse,
  ExplainFunctionIssueResponse,
  ReviewFunctionIssueRequest,
  ReviewFunctionIssueResponse,
  WorkbenchPreviewResponse,
  DecisionPreviewResponse,
  DraftHandoffPreviewResponse,
} from '@aiproj/types'

export interface ListFunctionAnalysesParams {
  page?: number
  perPage?: number
  status?: string
  sort?: string
}

export interface ListFunctionIssuesParams {
  page?: number
  perPage?: number
  issueType?: string
  severity?: string
  status?: string
  stale?: boolean
  sort?: string
}

const path = (projectId: number) => `/projects/${projectId}/triz/function-analysis-diagrams`

function query(params?: Record<string, unknown>): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) search.set(k, String(v))
    }
  }
  return search.size ? `?${search.toString()}` : ''
}

export const functionAnalysisApi = {
  create(projectId: number, body?: CreateFunctionAnalysisRequest) {
    return apiFetchEnvelope<CreateFunctionAnalysisResponse>(path(projectId), {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }).then((res) => res.data)
  },

  list(projectId: number, params?: ListFunctionAnalysesParams) {
    return apiFetchEnvelope<ListFunctionAnalysesResponse>(
      `${path(projectId)}${query(params as Record<string, unknown>)}`,
    )
  },

  get(projectId: number, runId: number) {
    return apiFetchEnvelope<FunctionAnalysisDetailResponse>(`${path(projectId)}/${runId}`).then(
      (res) => res.data,
    )
  },

  getGraph(projectId: number, runId: number) {
    return apiFetchEnvelope<FunctionAnalysisGraphResponse>(
      `${path(projectId)}/${runId}/graph`,
    ).then((res) => res.data)
  },

  listIssues(projectId: number, runId: number, params?: ListFunctionIssuesParams) {
    return apiFetchEnvelope<ListFunctionIssuesResponse>(
      `${path(projectId)}/${runId}/issues${query(params as Record<string, unknown>)}`,
    )
  },

  explain(projectId: number, runId: number, issueKey: string) {
    return apiFetchEnvelope<ExplainFunctionIssueResponse>(
      `${path(projectId)}/${runId}/issues/${issueKey}/explain`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  review(projectId: number, runId: number, issueKey: string, body: ReviewFunctionIssueRequest) {
    return apiFetchEnvelope<ReviewFunctionIssueResponse>(
      `${path(projectId)}/${runId}/issues/${issueKey}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ).then((res) => res.data)
  },

  workbenchPreview(projectId: number, runId: number, issueKey: string) {
    return apiFetchEnvelope<WorkbenchPreviewResponse>(
      `${path(projectId)}/${runId}/issues/${issueKey}/workbench-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  decisionPreview(projectId: number, runId: number, issueKey: string) {
    return apiFetchEnvelope<DecisionPreviewResponse>(
      `${path(projectId)}/${runId}/issues/${issueKey}/decision-preview`,
      { method: 'POST' },
    ).then((res) => res.data)
  },

  handoffPreview(projectId: number, runId: number, issueKey: string, targetType: string) {
    return apiFetchEnvelope<DraftHandoffPreviewResponse>(
      `${path(projectId)}/${runId}/issues/${issueKey}/handoff-preview`,
      { method: 'POST', body: JSON.stringify({ targetType }) },
    ).then((res) => res.data)
  },
}

export const functionAnalysisKeys = {
  all: ['triz-function-analysis'] as const,
  list: (projectId: number, params?: ListFunctionAnalysesParams) =>
    [...functionAnalysisKeys.all, 'runs', projectId, params ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...functionAnalysisKeys.all, 'run', projectId, runId] as const,
  graph: (projectId: number, runId: number) =>
    [...functionAnalysisKeys.all, 'graph', projectId, runId] as const,
  issues: (projectId: number, runId: number, params?: ListFunctionIssuesParams) =>
    [...functionAnalysisKeys.all, 'issues', projectId, runId, params ?? {}] as const,
}
