import { apiFetch } from '@/lib/api-client'
import type {
  OcrDocumentJobDetail,
  OcrDocumentJobSummary,
  OcrDocumentCandidate,
  OcrDocumentAcceptedExtraction,
  OcrDocumentJobCreateRequest,
  OcrDocumentJobRetryRequest,
  OcrDocumentConfirmationRequest,
  OcrDocumentJobListMeta,
} from '@aiproj/types'

/**
 * OCR 文档上传流——前端 API 客户端（v3-ocr-document-upload-flow §8.1）。
 */
export const ocrDocumentApi = {
  /** 创建 OCR 作业（从上传或已有附件） */
  create: (projectId: number, input: OcrDocumentJobCreateRequest & { file?: File }) => {
    if (input.file) {
      const formData = new FormData()
      formData.append('file', input.file)
      if (input.sourceAttachmentId)
        formData.append('sourceAttachmentId', String(input.sourceAttachmentId))
      if (input.connectionId) formData.append('connectionId', String(input.connectionId))
      if (input.modelId) formData.append('modelId', String(input.modelId))
      if (input.promptHint) formData.append('promptHint', input.promptHint)
      if (input.idempotencyKey) formData.append('idempotencyKey', input.idempotencyKey)
      if (input.pageLimit) formData.append('pageLimit', String(input.pageLimit))
      return apiFetch<{ data: OcrDocumentJobDetail }>(`/projects/${projectId}/ocr/document-jobs`, {
        method: 'POST',
        body: formData,
      })
    }
    return apiFetch<{ data: OcrDocumentJobDetail }>(`/projects/${projectId}/ocr/document-jobs`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  /** 列出项目的 OCR 作业 */
  list: (
    projectId: number,
    params?: { page?: number; perPage?: number; status?: string; sort?: string },
  ) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.perPage) query.set('perPage', String(params.perPage))
    if (params?.status) query.set('status', params.status)
    if (params?.sort) query.set('sort', params.sort)
    const qs = query.toString()
    return apiFetch<{ data: OcrDocumentJobSummary[]; meta: OcrDocumentJobListMeta }>(
      `/projects/${projectId}/ocr/document-jobs${qs ? `?${qs}` : ''}`,
    )
  },

  /** 获取作业详情 */
  detail: (projectId: number, jobId: number) =>
    apiFetch<{ data: OcrDocumentJobDetail }>(`/projects/${projectId}/ocr/document-jobs/${jobId}`),

  /** 获取作业候选 */
  candidates: (projectId: number, jobId: number) =>
    apiFetch<{ data: OcrDocumentCandidate[] }>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/candidates`,
    ),

  /** 重试作业 */
  retry: (projectId: number, jobId: number, input: OcrDocumentJobRetryRequest) =>
    apiFetch<{ data: OcrDocumentJobDetail }>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/retry`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 确认作业 */
  confirm: (projectId: number, jobId: number, input: OcrDocumentConfirmationRequest) =>
    apiFetch<{ data: OcrDocumentAcceptedExtraction }>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/confirm`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 获取已接受提取列表 */
  extractions: (projectId: number, jobId: number) =>
    apiFetch<{ data: OcrDocumentAcceptedExtraction[] }>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/extractions`,
    ),
}
