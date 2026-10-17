import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  CommentBodyFormat,
  CommentEntityType,
  CommentStatus,
  CommentWithAuthor,
  MentionCandidate,
} from '@aiproj/types'

export type Comment = CommentWithAuthor

export interface CommentListFilters {
  entityType?: CommentEntityType
  entityId?: number
  page?: number
  perPage?: number
  sort?: string
  status?: CommentStatus
}

export interface CommentListResponse {
  data: Comment[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface CreateCommentInput {
  body: string
  bodyFormat?: CommentBodyFormat
  entityType: CommentEntityType
  entityId: number
  parentId?: number | null
  mentions?: number[]
}

export interface UpdateCommentInput {
  body?: string
  bodyFormat?: CommentBodyFormat
}

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

// ---------------------------------------------------------------------------
// V2 统一实体评论
// ---------------------------------------------------------------------------

export async function listEntityComments(
  projectId: number,
  entityType: CommentEntityType,
  entityId: number,
  filters: CommentListFilters = {},
): Promise<CommentListResponse> {
  const q = qs({
    entityType,
    entityId,
    page: filters.page,
    perPage: filters.perPage,
    sort: filters.sort,
    status: filters.status,
  })
  return apiFetchEnvelope(`/projects/${projectId}/comments${q}`)
}

export async function createEntityComment(
  projectId: number,
  data: CreateCommentInput,
): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getComment(projectId: number, commentId: number): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments/${commentId}`)
}

// ---------------------------------------------------------------------------
// V1 兼容：项目级评论
// ---------------------------------------------------------------------------

export async function listProjectComments(
  projectId: number,
  filters: CommentListFilters = {},
): Promise<CommentListResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/comments${qs(filters)}`)
}

export async function createProjectComment(
  projectId: number,
  data: { body: string; bodyFormat?: CommentBodyFormat },
): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// V1 兼容：任务级评论
// ---------------------------------------------------------------------------

export async function listTaskComments(
  projectId: number,
  taskId: number,
  filters: CommentListFilters = {},
): Promise<CommentListResponse> {
  const q = qs({
    page: filters.page,
    perPage: filters.perPage,
    sort: filters.sort,
    status: filters.status,
  })
  return apiFetchEnvelope(`/projects/${projectId}/tasks/${taskId}/comments${q}`)
}

export async function createTaskComment(
  projectId: number,
  taskId: number,
  data: { body: string; bodyFormat?: CommentBodyFormat },
): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// 评论操作
// ---------------------------------------------------------------------------

export async function updateComment(
  projectId: number,
  commentId: number,
  data: UpdateCommentInput,
): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteComment(projectId: number, commentId: number): Promise<void> {
  return apiFetch(`/projects/${projectId}/comments/${commentId}`, { method: 'DELETE' })
}

export async function resolveComment(
  projectId: number,
  commentId: number,
): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments/${commentId}/resolve`, {
    method: 'POST',
  })
}

export async function reopenComment(
  projectId: number,
  commentId: number,
): Promise<{ data: Comment }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments/${commentId}/reopen`, {
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// 提及候选
// ---------------------------------------------------------------------------

export async function getMentionCandidates(
  projectId: number,
): Promise<{ data: MentionCandidate[] }> {
  return apiFetchEnvelope(`/projects/${projectId}/comments/mention-candidates`)
}
