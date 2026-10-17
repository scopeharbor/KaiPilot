'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  documentInlineCommentsApi,
  documentInlineCommentKeys,
} from '@/lib/api/document-inline-comments'
import type {
  CreateDocumentInlineCommentRequest,
  CreateDocumentInlineReplyRequest,
  ListDocumentInlineCommentsQuery,
  ReanchorRequest,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/** 内联批注列表。 */
export function useDocumentInlineComments(
  projectId: number,
  documentId: number,
  query: ListDocumentInlineCommentsQuery = {},
) {
  return useQuery({
    queryKey: documentInlineCommentKeys.list(projectId, documentId, query),
    queryFn: () => documentInlineCommentsApi.list(projectId, documentId, query),
    enabled: !!projectId && !!documentId,
  })
}

/** 单条内联批注详情。 */
export function useDocumentInlineComment(projectId: number, documentId: number, anchorId: number) {
  return useQuery({
    queryKey: documentInlineCommentKeys.detail(projectId, documentId, anchorId),
    queryFn: () => documentInlineCommentsApi.get(projectId, documentId, anchorId),
    enabled: !!projectId && !!documentId && !!anchorId,
  })
}

// ---------------------------------------------------------------------------
// 变更
// ---------------------------------------------------------------------------

/** 创建内联批注。 */
export function useCreateDocumentInlineComment(projectId: number, documentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateDocumentInlineCommentRequest) =>
      documentInlineCommentsApi.create(projectId, documentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.lists(projectId, documentId),
      })
    },
  })
}

/** 回复内联批注。 */
export function useReplyDocumentInlineComment(projectId: number, documentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      anchorId,
      data,
    }: {
      anchorId: number
      data: CreateDocumentInlineReplyRequest
    }) => documentInlineCommentsApi.reply(projectId, documentId, anchorId, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.lists(projectId, documentId),
      })
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.detail(projectId, documentId, variables.anchorId),
      })
    },
  })
}

/** 解决内联批注线程。 */
export function useResolveDocumentInlineComment(projectId: number, documentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (anchorId: number) =>
      documentInlineCommentsApi.resolve(projectId, documentId, anchorId),
    onSuccess: (_result, anchorId) => {
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.lists(projectId, documentId),
      })
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.detail(projectId, documentId, anchorId),
      })
    },
  })
}

/** 重开内联批注线程。 */
export function useReopenDocumentInlineComment(projectId: number, documentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (anchorId: number) =>
      documentInlineCommentsApi.reopen(projectId, documentId, anchorId),
    onSuccess: (_result, anchorId) => {
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.lists(projectId, documentId),
      })
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.detail(projectId, documentId, anchorId),
      })
    },
  })
}

/** 删除内联批注。 */
export function useDeleteDocumentInlineComment(projectId: number, documentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (anchorId: number) =>
      documentInlineCommentsApi.delete(projectId, documentId, anchorId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.lists(projectId, documentId),
      })
    },
  })
}

/** 重设 anchor。 */
export function useReanchorDocumentInlineComment(projectId: number, documentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ anchorId, data }: { anchorId: number; data: ReanchorRequest }) =>
      documentInlineCommentsApi.reanchor(projectId, documentId, anchorId, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.lists(projectId, documentId),
      })
      queryClient.invalidateQueries({
        queryKey: documentInlineCommentKeys.detail(projectId, documentId, variables.anchorId),
      })
    },
  })
}
