import { apiFetch } from '@/lib/api-client'
import type {
  OcrBatchDetail,
  OcrBatchSummary,
  OcrBatchCreateRequest,
  OcrBatchRetryRequest,
  OcrBatchCancelRequest,
  OcrBatchResumeRequest,
  OcrQueueItemSummary,
  OcrQueueProjectSummary,
  OcrBatchListFilters,
  OcrQueueListFilters,
} from '@aiproj/types'

export interface PaginatedBatches {
  data: OcrBatchSummary[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface PaginatedQueueItems {
  data: OcrQueueItemSummary[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

/**
 * OCR 批量/队列——前端 API 客户端（v3-ocr-batch-and-queue-processing §6.1）。
 */
export const ocrBatchApi = {
  /** 创建 OCR batch */
  create: (projectId: number, input: OcrBatchCreateRequest) =>
    apiFetch<{ data: OcrBatchDetail }>(`/projects/${projectId}/ocr/batches`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 列出项目的 OCR batches */
  list: (projectId: number, params?: OcrBatchListFilters) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.perPage) query.set('perPage', String(params.perPage))
    if (params?.status) query.set('status', params.status)
    if (params?.sort) query.set('sort', params.sort)
    const qs = query.toString()
    return apiFetch<PaginatedBatches>(`/projects/${projectId}/ocr/batches${qs ? `?${qs}` : ''}`)
  },

  /** 获取 batch 详情 */
  detail: (projectId: number, batchId: number) =>
    apiFetch<{ data: OcrBatchDetail }>(`/projects/${projectId}/ocr/batches/${batchId}`),

  /** 重试 batch */
  retry: (projectId: number, batchId: number, input?: OcrBatchRetryRequest) =>
    apiFetch<{ data: OcrBatchDetail }>(`/projects/${projectId}/ocr/batches/${batchId}/retry`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  /** 取消 batch */
  cancel: (projectId: number, batchId: number, input?: OcrBatchCancelRequest) =>
    apiFetch<{ data: OcrBatchDetail }>(`/projects/${projectId}/ocr/batches/${batchId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  /** 恢复 batch */
  resume: (projectId: number, batchId: number, input?: OcrBatchResumeRequest) =>
    apiFetch<{ data: OcrBatchDetail }>(`/projects/${projectId}/ocr/batches/${batchId}/resume`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  /** 获取队列摘要 */
  queueSummary: (projectId: number) =>
    apiFetch<{ data: OcrQueueProjectSummary }>(`/projects/${projectId}/ocr/queue/summary`),

  /** 列出队列项 */
  queueList: (projectId: number, params?: OcrQueueListFilters) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.perPage) query.set('perPage', String(params.perPage))
    if (params?.status) query.set('status', params.status)
    if (params?.batchId) query.set('batchId', String(params.batchId))
    if (params?.sort) query.set('sort', params.sort)
    const qs = query.toString()
    return apiFetch<PaginatedQueueItems>(`/projects/${projectId}/ocr/queue${qs ? `?${qs}` : ''}`)
  },
}
