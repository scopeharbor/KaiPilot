'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listEntityComments,
  createEntityComment,
  getComment,
  listProjectComments,
  createProjectComment,
  listTaskComments,
  createTaskComment,
  updateComment,
  deleteComment,
  resolveComment,
  reopenComment,
  getMentionCandidates,
  type CommentListFilters,
  type UpdateCommentInput,
} from '@/lib/api/comments'
import { taskKeys } from '@/lib/api/tasks'
import type { CommentBodyFormat, CommentEntityType } from '@aiproj/types'

export const commentKeys = {
  all: ['comments'] as const,
  entityLists: () => [...commentKeys.all, 'entity-list'] as const,
  entityList: (
    projectId: number,
    entityType: string,
    entityId: number,
    filters?: CommentListFilters,
  ) => [...commentKeys.entityLists(), projectId, entityType, entityId, filters] as const,
  detail: (projectId: number, commentId: number) =>
    [...commentKeys.all, 'detail', projectId, commentId] as const,
  projectLists: () => [...commentKeys.all, 'project-list'] as const,
  projectList: (projectId: number, filters?: CommentListFilters) =>
    [...commentKeys.projectLists(), projectId, filters] as const,
  taskLists: () => [...commentKeys.all, 'task-list'] as const,
  taskList: (projectId: number, taskId: number, filters?: CommentListFilters) =>
    [...commentKeys.taskLists(), projectId, taskId, filters] as const,
  mentionCandidates: (projectId: number) =>
    [...commentKeys.all, 'mention-candidates', projectId] as const,
}

// ---------------------------------------------------------------------------
// V2 实体评论
// ---------------------------------------------------------------------------

export function useEntityComments(
  projectId: number,
  entityType: CommentEntityType,
  entityId: number,
  filters: CommentListFilters = {},
) {
  return useQuery({
    queryKey: commentKeys.entityList(projectId, entityType, entityId, filters),
    queryFn: () => listEntityComments(projectId, entityType, entityId, filters),
    enabled: !!projectId && !!entityType && !!entityId,
  })
}

export function useCreateEntityComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      entityType: CommentEntityType
      entityId: number
      body: string
      bodyFormat?: CommentBodyFormat
      parentId?: number | null
      mentions?: number[]
    }) => createEntityComment(projectId, data),
    onSuccess: (result) => {
      const entityType = result.data.entityType
      const entityId = result.data.entityId
      queryClient.invalidateQueries({
        queryKey: [...commentKeys.entityLists(), projectId, entityType, entityId],
      })
      queryClient.invalidateQueries({ queryKey: commentKeys.projectLists() })
      queryClient.invalidateQueries({ queryKey: commentKeys.taskLists() })
      if (entityType === 'task') {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(projectId, entityId) })
      }
    },
  })
}

export function useCommentDetail(projectId: number, commentId: number) {
  return useQuery({
    queryKey: commentKeys.detail(projectId, commentId),
    queryFn: () => getComment(projectId, commentId),
    enabled: !!projectId && !!commentId,
  })
}

// ---------------------------------------------------------------------------
// V1 兼容：项目级评论
// ---------------------------------------------------------------------------

export function useProjectComments(projectId: number, filters: CommentListFilters = {}) {
  return useQuery({
    queryKey: commentKeys.projectList(projectId, filters),
    queryFn: () => listProjectComments(projectId, filters),
    enabled: !!projectId,
  })
}

export function useCreateProjectComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { body: string; bodyFormat?: CommentBodyFormat }) =>
      createProjectComment(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.projectLists() })
    },
  })
}

// ---------------------------------------------------------------------------
// V1 兼容：任务级评论
// ---------------------------------------------------------------------------

export function useTaskComments(
  projectId: number,
  taskId: number,
  filters: CommentListFilters = {},
) {
  return useQuery({
    queryKey: commentKeys.taskList(projectId, taskId, filters),
    queryFn: () => listTaskComments(projectId, taskId, filters),
    enabled: !!projectId && !!taskId,
  })
}

export function useCreateTaskComment(projectId: number, taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { body: string; bodyFormat?: CommentBodyFormat }) =>
      createTaskComment(projectId, taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commentKeys.taskList(projectId, taskId),
      })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(projectId, taskId) })
    },
  })
}

// ---------------------------------------------------------------------------
// 评论操作
// ---------------------------------------------------------------------------

export function useUpdateComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ commentId, data }: { commentId: number; data: UpdateCommentInput }) =>
      updateComment(projectId, commentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all })
    },
  })
}

export function useDeleteComment(projectId: number, taskId?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => deleteComment(projectId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all })
      // 同时刷新任务详情中的 commentCount
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(projectId, taskId) })
      }
    },
  })
}

export function useResolveComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => resolveComment(projectId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all })
    },
  })
}

export function useReopenComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => reopenComment(projectId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all })
    },
  })
}

// ---------------------------------------------------------------------------
// 提及候选
// ---------------------------------------------------------------------------

export function useMentionCandidates(projectId: number) {
  return useQuery({
    queryKey: commentKeys.mentionCandidates(projectId),
    queryFn: () => getMentionCandidates(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  })
}
