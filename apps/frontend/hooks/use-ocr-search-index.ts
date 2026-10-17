/**
 * OCR 搜索索引——TanStack Query Hooks（v3-ocr-document-search-indexing §8.2）。
 *
 * 提供 OCR 搜索索引状态查询与 mutation hooks。
 * 所有操作需项目成员权限，前端通过 API 错误码处理权限降级。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrSearchIndexApi } from '@/lib/api/ocr-search-index'
import type {
  OcrSearchIndexListQuery,
  OcrSearchIndexPreviewRequest,
  OcrSearchIndexExecuteRequest,
  OcrSearchIndexReindexRequest,
  OcrSearchIndexUnindexRequest,
} from '@aiproj/types'

// ─── Query Keys ───────────────────────────────────────────────────────────

export const ocrSearchIndexKeys = {
  all: (projectId: number) => ['ocr-search-index', projectId] as const,
  list: (projectId: number, query?: OcrSearchIndexListQuery) =>
    [...ocrSearchIndexKeys.all(projectId), 'list', query] as const,
}

// ─── Queries ──────────────────────────────────────────────────────────────

/** 获取 OCR 搜索索引状态列表 */
export function useOcrSearchIndexList(projectId: number, query?: OcrSearchIndexListQuery) {
  return useQuery({
    queryKey: ocrSearchIndexKeys.list(projectId, query),
    queryFn: () => ocrSearchIndexApi.list(projectId, query),
    enabled: !!projectId,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────

/** 预览索引 */
export function useOcrSearchIndexPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: OcrSearchIndexPreviewRequest) =>
      ocrSearchIndexApi.preview(projectId, input),
  })
}

/** 执行索引 */
export function useOcrSearchIndexExecute(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrSearchIndexExecuteRequest) =>
      ocrSearchIndexApi.execute(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrSearchIndexKeys.all(projectId) })
    },
  })
}

/** 重新索引预览 */
export function useOcrSearchIndexReindexPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: OcrSearchIndexReindexRequest) =>
      ocrSearchIndexApi.reindexPreview(projectId, input),
  })
}

/** 执行重新索引 */
export function useOcrSearchIndexReindexExecute(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrSearchIndexExecuteRequest) =>
      ocrSearchIndexApi.reindexExecute(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrSearchIndexKeys.all(projectId) })
    },
  })
}

/** 取消索引预览 */
export function useOcrSearchIndexUnindexPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: OcrSearchIndexUnindexRequest) =>
      ocrSearchIndexApi.unindexPreview(projectId, input),
  })
}

/** 执行取消索引 */
export function useOcrSearchIndexUnindexExecute(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrSearchIndexExecuteRequest & OcrSearchIndexUnindexRequest) =>
      ocrSearchIndexApi.unindexExecute(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrSearchIndexKeys.all(projectId) })
    },
  })
}
