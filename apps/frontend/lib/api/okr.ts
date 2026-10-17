// OKR 层级管理 API client（v3-okr-hierarchy-management §6.1）。
import { apiFetch } from '@/lib/api-client'
import type {
  OkrCycleListResponse,
  OkrCycleResponse,
  OkrObjectiveListResponse,
  OkrObjectiveDetailResponse,
  OkrObjectiveResponse,
  OkrKeyResultListResponse,
  OkrKeyResultResponse,
  OkrAlignment,
  OkrAlignmentListResponse,
  OkrEvidenceLink,
  OkrEvidenceLinkListResponse,
  OkrProgressHistoryListResponse,
  OkrTreeResponse,
  OkrAiDraftResponse,
  OkrCycleCreateRequest,
  OkrCycleUpdateRequest,
  OkrObjectiveCreateRequest,
  OkrObjectiveUpdateRequest,
  OkrKeyResultCreateRequest,
  OkrKeyResultUpdateRequest,
  OkrProgressUpdateRequest,
  OkrAlignmentCreateRequest,
  OkrEvidenceLinkCreateRequest,
  OkrAiDraftRequest,
  OkrAiDraftConfirmationRequest,
  OkrCycleListQuery,
  OkrObjectiveListQuery,
  OkrTreeQuery,
  OkrKeyResultListQuery,
  OkrEvidenceListQuery,
} from '@aiproj/types'

const okrPath = (organizationId: number) => `/organizations/${organizationId}/okrs`

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach((v) => query.append(key, String(v)))
      } else {
        query.set(key, String(value))
      }
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

// ── Cycles ─────────────────────────────────────────────────────────────────

export const okrCyclesApi = {
  list: (organizationId: number, query: OkrCycleListQuery = {}) =>
    apiFetch<OkrCycleListResponse>(
      `${okrPath(organizationId)}/cycles${buildQuery(query as Record<string, unknown>)}`,
    ),
  get: (organizationId: number, cycleId: number) =>
    apiFetch<OkrCycleResponse>(`${okrPath(organizationId)}/cycles/${cycleId}`),
  create: (organizationId: number, input: OkrCycleCreateRequest) =>
    apiFetch<OkrCycleResponse>(`${okrPath(organizationId)}/cycles`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (organizationId: number, cycleId: number, input: OkrCycleUpdateRequest) =>
    apiFetch<OkrCycleResponse>(`${okrPath(organizationId)}/cycles/${cycleId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  archive: (organizationId: number, cycleId: number) =>
    apiFetch<OkrCycleResponse>(`${okrPath(organizationId)}/cycles/${cycleId}/archive`, {
      method: 'POST',
    }),
  restore: (organizationId: number, cycleId: number) =>
    apiFetch<OkrCycleResponse>(`${okrPath(organizationId)}/cycles/${cycleId}/restore`, {
      method: 'POST',
    }),
}

// ── Objectives ─────────────────────────────────────────────────────────────

export const okrObjectivesApi = {
  list: (organizationId: number, query: OkrObjectiveListQuery = {}) =>
    apiFetch<OkrObjectiveListResponse>(
      `${okrPath(organizationId)}/objectives${buildQuery(query as Record<string, unknown>)}`,
    ),
  get: (organizationId: number, objectiveId: number) =>
    apiFetch<OkrObjectiveDetailResponse>(`${okrPath(organizationId)}/objectives/${objectiveId}`),
  create: (organizationId: number, input: OkrObjectiveCreateRequest) =>
    apiFetch<OkrObjectiveResponse>(`${okrPath(organizationId)}/objectives`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (organizationId: number, objectiveId: number, input: OkrObjectiveUpdateRequest) =>
    apiFetch<OkrObjectiveResponse>(`${okrPath(organizationId)}/objectives/${objectiveId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  archive: (organizationId: number, objectiveId: number) =>
    apiFetch<OkrObjectiveResponse>(`${okrPath(organizationId)}/objectives/${objectiveId}/archive`, {
      method: 'POST',
    }),
  restore: (organizationId: number, objectiveId: number) =>
    apiFetch<OkrObjectiveResponse>(`${okrPath(organizationId)}/objectives/${objectiveId}/restore`, {
      method: 'POST',
    }),
}

// ── Tree ───────────────────────────────────────────────────────────────────

export const okrTreeApi = {
  get: (organizationId: number, query: OkrTreeQuery = {}) =>
    apiFetch<OkrTreeResponse>(
      `${okrPath(organizationId)}/tree${buildQuery(query as Record<string, unknown>)}`,
    ),
}

// ── Key Results ────────────────────────────────────────────────────────────

export const okrKeyResultsApi = {
  list: (organizationId: number, query: OkrKeyResultListQuery = {}) =>
    apiFetch<OkrKeyResultListResponse>(
      `${okrPath(organizationId)}/key-results${buildQuery(query as Record<string, unknown>)}`,
    ),
  get: (organizationId: number, krId: number) =>
    apiFetch<OkrKeyResultResponse>(`${okrPath(organizationId)}/key-results/${krId}`),
  create: (organizationId: number, input: OkrKeyResultCreateRequest) =>
    apiFetch<OkrKeyResultResponse>(`${okrPath(organizationId)}/key-results`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (organizationId: number, krId: number, input: OkrKeyResultUpdateRequest) =>
    apiFetch<OkrKeyResultResponse>(`${okrPath(organizationId)}/key-results/${krId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  archive: (organizationId: number, krId: number) =>
    apiFetch<OkrKeyResultResponse>(`${okrPath(organizationId)}/key-results/${krId}/archive`, {
      method: 'POST',
    }),
}

// ── Progress ───────────────────────────────────────────────────────────────

export const okrProgressApi = {
  update: (organizationId: number, krId: number, input: OkrProgressUpdateRequest) =>
    apiFetch<OkrKeyResultResponse>(`${okrPath(organizationId)}/key-results/${krId}/progress`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  history: (organizationId: number, krId: number) =>
    apiFetch<OkrProgressHistoryListResponse>(
      `${okrPath(organizationId)}/key-results/${krId}/progress-history`,
    ),
}

// ── Alignments ─────────────────────────────────────────────────────────────

export const okrAlignmentsApi = {
  create: (organizationId: number, input: OkrAlignmentCreateRequest) =>
    apiFetch<{ data: OkrAlignment }>(`${okrPath(organizationId)}/alignments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (organizationId: number, alignmentId: number) =>
    apiFetch<{ data: OkrAlignment }>(`${okrPath(organizationId)}/alignments/${alignmentId}`, {
      method: 'DELETE',
    }),
  listForObjective: (organizationId: number, objectiveId: number) =>
    apiFetch<OkrAlignmentListResponse>(
      `${okrPath(organizationId)}/objectives/${objectiveId}/alignments`,
    ),
}

// ── Evidence ───────────────────────────────────────────────────────────────

export const okrEvidenceApi = {
  create: (organizationId: number, input: OkrEvidenceLinkCreateRequest) =>
    apiFetch<{ data: OkrEvidenceLink }>(`${okrPath(organizationId)}/evidence`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  list: (organizationId: number, query: OkrEvidenceListQuery = {}) =>
    apiFetch<OkrEvidenceLinkListResponse>(
      `${okrPath(organizationId)}/evidence${buildQuery(query as Record<string, unknown>)}`,
    ),
}

// ── AI Draft ───────────────────────────────────────────────────────────────

export const okrAiDraftApi = {
  generate: (organizationId: number, input: OkrAiDraftRequest) =>
    apiFetch<OkrAiDraftResponse>(`${okrPath(organizationId)}/ai-drafts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  confirm: (organizationId: number, input: OkrAiDraftConfirmationRequest) =>
    apiFetch<{ data: unknown[] }>(`${okrPath(organizationId)}/ai-drafts/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

// ── Progress Backflow ─────────────────────────────────────────────────────

import type {
  OkrBackflowSuggestion,
  OkrBackflowSuggestionListResponse,
  OkrBackflowBatchRecalculateResponse,
  OkrBackflowListQuery,
} from '@aiproj/types'

export const okrBackflowApi = {
  list: (organizationId: number, query: OkrBackflowListQuery = {}) =>
    apiFetch<OkrBackflowSuggestionListResponse>(
      `${okrPath(organizationId)}/backflow/suggestions${buildQuery(query as Record<string, unknown>)}`,
    ),
  get: (organizationId: number, suggestionId: number) =>
    apiFetch<{ data: OkrBackflowSuggestion }>(
      `${okrPath(organizationId)}/backflow/suggestions/${suggestionId}`,
    ),
  recalculate: (organizationId: number, keyResultId: number) =>
    apiFetch<{ data: OkrBackflowSuggestion }>(`${okrPath(organizationId)}/backflow/recalculate`, {
      method: 'POST',
      body: JSON.stringify({ keyResultId }),
    }),
  batchRecalculate: (
    organizationId: number,
    scope: 'objective' | 'cycle',
    scopeId: number,
    maxKrCount?: number,
  ) =>
    apiFetch<OkrBackflowBatchRecalculateResponse>(
      `${okrPath(organizationId)}/backflow/batch-recalculate`,
      {
        method: 'POST',
        body: JSON.stringify({ scope, scopeId, maxKrCount }),
      },
    ),
  confirm: (organizationId: number, suggestionId: number, note?: string | null) =>
    apiFetch<{ data: OkrBackflowSuggestion }>(`${okrPath(organizationId)}/backflow/confirm`, {
      method: 'POST',
      body: JSON.stringify({ suggestionId, note }),
    }),
  reject: (organizationId: number, suggestionId: number, reasonCode: string, reasonNote: string) =>
    apiFetch<{ data: OkrBackflowSuggestion }>(`${okrPath(organizationId)}/backflow/reject`, {
      method: 'POST',
      body: JSON.stringify({ suggestionId, reasonCode, reasonNote }),
    }),
}
