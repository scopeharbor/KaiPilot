'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { filesV2Api, fileKeys } from '@/lib/api/files'
import type { SearchFilters, BatchItem } from '@/lib/api/files'

/**
 * V2 文件管理 TanStack Query hooks（v2-file-management-upgrade）。
 * 覆盖：版本、标签、实体关联、搜索、回收站、批量操作。
 */

// === 版本 ===

/** 列出版本。 */
export function useVersions(projectId: number, attachmentId: number) {
  return useQuery({
    queryKey: fileKeys.versions(projectId, attachmentId),
    queryFn: () => filesV2Api.listVersions(projectId, attachmentId),
    enabled: !!projectId && !!attachmentId,
  })
}

/** 上传新版本。 */
export function useUploadVersion(projectId: number, attachmentId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ file, changeNote }: { file: File; changeNote?: string }) =>
      filesV2Api.uploadVersion(projectId, attachmentId, file, changeNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.versions(projectId, attachmentId) })
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

/** 回滚版本。 */
export function useRollbackVersion(projectId: number, attachmentId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (targetVersionNo: number) =>
      filesV2Api.rollbackVersion(projectId, attachmentId, targetVersionNo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.versions(projectId, attachmentId) })
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

// === 标签 ===

/** 列出标签。 */
export function useFileTags(projectId: number) {
  return useQuery({
    queryKey: fileKeys.tags(projectId),
    queryFn: () => filesV2Api.listTags(projectId),
    enabled: !!projectId,
  })
}

/** 创建标签。 */
export function useCreateTag(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { name: string; color?: string | null }) =>
      filesV2Api.createTag(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.tags(projectId) })
    },
  })
}

/** 更新标签。 */
export function useUpdateTag(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ tagId, name, color }: { tagId: number; name?: string; color?: string }) =>
      filesV2Api.updateTag(projectId, tagId, { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.tags(projectId) })
    },
  })
}

/** 删除标签。 */
export function useDeleteTag(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (tagId: number) => filesV2Api.deleteTag(projectId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.tags(projectId) })
    },
  })
}

/** 分配标签。 */
export function useAssignTags(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { fileType: string; fileId: number; tagIds: number[] }) =>
      filesV2Api.assignTags(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

// === 实体关联 ===

/** 列出实体关联文件。 */
export function useEntityFiles(projectId: number, entityType: string, entityId: number) {
  return useQuery({
    queryKey: fileKeys.entityLinks(projectId, entityType, entityId),
    queryFn: () => filesV2Api.listEntityFiles(projectId, entityType, entityId),
    enabled: !!projectId && !!entityType && !!entityId,
  })
}

/** 创建实体关联。 */
export function useCreateLink(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      fileType: string
      fileId: number
      entityType: string
      entityId: number
      linkType?: string
    }) => filesV2Api.createLink(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

/** 删除实体关联。 */
export function useDeleteLink(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (linkId: number) => filesV2Api.deleteLink(projectId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

// === 搜索 ===

/** 搜索文件。 */
export function useSearchFiles(projectId: number, filters: SearchFilters) {
  return useQuery({
    queryKey: [...fileKeys.search(projectId), filters] as const,
    queryFn: () => filesV2Api.search(projectId, filters),
    enabled: !!projectId && !!filters.q,
  })
}

// === 回收站 ===

/** 回收站列表。 */
export function useTrashList(
  projectId: number,
  filters: { page?: number; perPage?: number; search?: string } = {},
) {
  return useQuery({
    queryKey: [...fileKeys.trash(projectId), filters] as const,
    queryFn: () => filesV2Api.listTrash(projectId, filters),
    enabled: !!projectId,
  })
}

/** 移动到回收站。 */
export function useTrash(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ attachmentId, reason }: { attachmentId: number; reason?: string }) =>
      filesV2Api.trash(projectId, attachmentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
      queryClient.invalidateQueries({ queryKey: fileKeys.trash(projectId) })
    },
  })
}

/** 从回收站恢复。 */
export function useRestore(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (attachmentId: number) => filesV2Api.restore(projectId, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
      queryClient.invalidateQueries({ queryKey: fileKeys.trash(projectId) })
    },
  })
}

/** 永久删除。 */
export function usePermanentDelete(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (attachmentId: number) => filesV2Api.permanentDelete(projectId, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
      queryClient.invalidateQueries({ queryKey: fileKeys.trash(projectId) })
    },
  })
}

// === 批量操作 ===

/** 批量删除。 */
export function useBatchDelete(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: BatchItem[]) => filesV2Api.batchDelete(projectId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

/** 批量恢复。 */
export function useBatchRestore(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: BatchItem[]) => filesV2Api.batchRestore(projectId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

/** 批量永久删除。 */
export function useBatchPermanentDelete(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: BatchItem[]) => filesV2Api.batchPermanentDelete(projectId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}

/** 批量打标签。 */
export function useBatchTag(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ items, tagIds }: { items: BatchItem[]; tagIds: number[] }) =>
      filesV2Api.batchTag(projectId, items, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.all })
    },
  })
}
