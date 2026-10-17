/**
 * v3-ocr-batch-and-queue-processing §6.2 — OCR 批量/队列 TanStack Query hooks。
 *
 * 特性：
 * - 稳定 query keys（按 project/batch 分层）
 * - 处理中 batch 轮询（5s 间隔）
 * - 控制操作后自动失效相关查询
 * - 无重复 mutation 行为
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrBatchApi } from '@/lib/api/ocr-batch'
import type {
  OcrBatchCreateRequest,
  OcrBatchRetryRequest,
  OcrBatchCancelRequest,
  OcrBatchResumeRequest,
  OcrBatchListFilters,
  OcrQueueListFilters,
} from '@aiproj/types'

// ── Query Keys ──

const batchKeys = {
  all: (projectId: number) => ['ocr-batch', projectId] as const,
  lists: (projectId: number) => ['ocr-batch', projectId, 'list'] as const,
  detail: (projectId: number, batchId: number) =>
    ['ocr-batch', projectId, 'detail', batchId] as const,
  queueSummary: (projectId: number) => ['ocr-batch', projectId, 'queue', 'summary'] as const,
  queueList: (projectId: number) => ['ocr-batch', projectId, 'queue', 'list'] as const,
}

// ── Queries ──

/** 列出 project 的 OCR batches */
export function useOcrBatches(projectId: number, params?: OcrBatchListFilters) {
  return useQuery({
    queryKey: [...batchKeys.lists(projectId), params],
    queryFn: () => ocrBatchApi.list(projectId, params),
    // Polling for active batches
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data?.data) return false
      const hasActive = data.data.some(
        (b) => b.status === 'queued' || b.status === 'processing' || b.status === 'partial',
      )
      return hasActive ? 5000 : false
    },
  })
}

/** 获取 batch 详情 */
export function useOcrBatchDetail(projectId: number, batchId: number) {
  return useQuery({
    queryKey: batchKeys.detail(projectId, batchId),
    queryFn: () => ocrBatchApi.detail(projectId, batchId),
    enabled: batchId > 0,
    refetchInterval: (query) => {
      const data = query.state.data?.data
      if (!data) return false
      const active: string[] = ['queued', 'processing', 'partial', 'paused']
      return active.includes(data.status) ? 5000 : false
    },
  })
}

/** 队列摘要 */
export function useOcrQueueSummary(projectId: number) {
  return useQuery({
    queryKey: batchKeys.queueSummary(projectId),
    queryFn: () => ocrBatchApi.queueSummary(projectId),
    refetchInterval: (query) => {
      const data = query.state.data?.data
      if (!data) return false
      return data.queued + data.processing > 0 ? 5000 : false
    },
  })
}

/** 队列项列表 */
export function useOcrQueueItems(projectId: number, params?: OcrQueueListFilters) {
  return useQuery({
    queryKey: [...batchKeys.queueList(projectId), params],
    queryFn: () => ocrBatchApi.queueList(projectId, params),
  })
}

// ── Mutations ──

/** 创建 OCR batch */
export function useCreateOcrBatch(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OcrBatchCreateRequest) => ocrBatchApi.create(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.queueSummary(projectId) })
    },
  })
}

/** 重试 batch */
export function useRetryOcrBatch(projectId: number, batchId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input?: OcrBatchRetryRequest) => ocrBatchApi.retry(projectId, batchId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(projectId, batchId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.queueList(projectId) })
    },
  })
}

/** 取消 batch */
export function useCancelOcrBatch(projectId: number, batchId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input?: OcrBatchCancelRequest) => ocrBatchApi.cancel(projectId, batchId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(projectId, batchId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.queueList(projectId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.queueSummary(projectId) })
    },
  })
}

/** 恢复 batch */
export function useResumeOcrBatch(projectId: number, batchId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input?: OcrBatchResumeRequest) => ocrBatchApi.resume(projectId, batchId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(projectId, batchId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.queueList(projectId) })
      queryClient.invalidateQueries({ queryKey: batchKeys.queueSummary(projectId) })
    },
  })
}
