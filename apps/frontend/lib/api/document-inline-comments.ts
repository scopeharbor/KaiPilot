import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  CreateDocumentInlineCommentRequest,
  CreateDocumentInlineReplyRequest,
  ListDocumentInlineCommentsQuery,
  ListDocumentInlineCommentsResponse,
  GetDocumentInlineCommentResponse,
  CreateDocumentInlineCommentResponse,
  ReanchorRequest,
  ReanchorResponse,
} from '@aiproj/types'

function qs(filters: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (
      value !== undefined &&
      value !== null &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      params.set(key, String(value))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const documentInlineCommentsApi = {
  /** 列出文档内联批注。 */
  list: (
    projectId: number,
    documentId: number,
    query: ListDocumentInlineCommentsQuery = {},
  ): Promise<ListDocumentInlineCommentsResponse> => {
    return apiFetchEnvelope(
      `/projects/${projectId}/documents/${documentId}/inline-comments${qs(query)}`,
    )
  },

  /** 创建内联批注。 */
  create: (
    projectId: number,
    documentId: number,
    data: CreateDocumentInlineCommentRequest,
  ): Promise<CreateDocumentInlineCommentResponse> => {
    return apiFetchEnvelope(`/projects/${projectId}/documents/${documentId}/inline-comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /** 获取单条内联批注详情。 */
  get: (
    projectId: number,
    documentId: number,
    anchorId: number,
  ): Promise<GetDocumentInlineCommentResponse> => {
    return apiFetchEnvelope(
      `/projects/${projectId}/documents/${documentId}/inline-comments/${anchorId}`,
    )
  },

  /** 回复内联批注。 */
  reply: (
    projectId: number,
    documentId: number,
    anchorId: number,
    data: CreateDocumentInlineReplyRequest,
  ): Promise<CreateDocumentInlineCommentResponse> => {
    return apiFetchEnvelope(
      `/projects/${projectId}/documents/${documentId}/inline-comments/${anchorId}/replies`,
      { method: 'POST', body: JSON.stringify(data) },
    )
  },

  /** 解决内联批注线程。 */
  resolve: (
    projectId: number,
    documentId: number,
    anchorId: number,
  ): Promise<{ data: unknown }> => {
    return apiFetchEnvelope(
      `/projects/${projectId}/documents/${documentId}/inline-comments/${anchorId}/resolve`,
      { method: 'POST' },
    )
  },

  /** 重开内联批注线程。 */
  reopen: (projectId: number, documentId: number, anchorId: number): Promise<{ data: unknown }> => {
    return apiFetchEnvelope(
      `/projects/${projectId}/documents/${documentId}/inline-comments/${anchorId}/reopen`,
      { method: 'POST' },
    )
  },

  /** 删除内联批注。 */
  delete: (projectId: number, documentId: number, anchorId: number): Promise<void> => {
    return apiFetch(`/projects/${projectId}/documents/${documentId}/inline-comments/${anchorId}`, {
      method: 'DELETE',
    })
  },

  /** 重设 anchor。 */
  reanchor: (
    projectId: number,
    documentId: number,
    anchorId: number,
    data: ReanchorRequest,
  ): Promise<ReanchorResponse> => {
    return apiFetchEnvelope(
      `/projects/${projectId}/documents/${documentId}/inline-comments/${anchorId}/reanchor`,
      { method: 'PATCH', body: JSON.stringify(data) },
    )
  },
}

// === TanStack Query Keys ===

export const documentInlineCommentKeys = {
  all: ['document-inline-comments'] as const,
  lists: (projectId: number, documentId: number) =>
    [...documentInlineCommentKeys.all, 'list', projectId, documentId] as const,
  list: (projectId: number, documentId: number, query: ListDocumentInlineCommentsQuery) =>
    [...documentInlineCommentKeys.lists(projectId, documentId), query] as const,
  detail: (projectId: number, documentId: number, anchorId: number) =>
    [...documentInlineCommentKeys.all, 'detail', projectId, documentId, anchorId] as const,
}
