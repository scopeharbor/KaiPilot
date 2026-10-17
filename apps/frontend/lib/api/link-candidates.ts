import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  ListCandidatesResponse,
  CandidateActionResponse,
  ConfirmCandidateRequest,
  IgnoreCandidateRequest,
} from '@aiproj/types'

/**
 * v2-5-code-repository-auto-linking —— 链接候选 API 客户端。
 */

export const linkCandidateKeys = {
  all: ['link-candidates'] as const,
  list: (projectId: number, taskId: number) =>
    [...linkCandidateKeys.all, 'list', projectId, taskId] as const,
}

export const linkCandidatesApi = {
  list: (
    projectId: number,
    taskId: number,
    params?: { status?: string; page?: number; perPage?: number },
  ) => {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.page) query.set('page', String(params.page))
    if (params?.perPage) query.set('perPage', String(params.perPage))
    const qs = query.toString()
    return apiFetchEnvelope<ListCandidatesResponse>(
      `/projects/${projectId}/tasks/${taskId}/link-candidates${qs ? `?${qs}` : ''}`,
    )
  },

  confirm: (
    projectId: number,
    taskId: number,
    candidateId: number,
    data?: ConfirmCandidateRequest,
  ) =>
    apiFetchEnvelope<{ data: CandidateActionResponse }>(
      `/projects/${projectId}/tasks/${taskId}/link-candidates/${candidateId}/confirm`,
      { method: 'POST', body: data ? JSON.stringify(data) : undefined },
    ),

  ignore: (projectId: number, taskId: number, candidateId: number, data?: IgnoreCandidateRequest) =>
    apiFetchEnvelope<{ data: CandidateActionResponse }>(
      `/projects/${projectId}/tasks/${taskId}/link-candidates/${candidateId}/ignore`,
      { method: 'POST', body: data ? JSON.stringify(data) : undefined },
    ),
}
