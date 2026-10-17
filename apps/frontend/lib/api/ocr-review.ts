import { apiFetch } from '@/lib/api-client'
import type {
  OcrReviewDetailResponse,
  OcrAcceptedExtractionSummary,
  OcrAcceptedExtractionListMeta,
  OcrConfirmationPreviewRequest,
  OcrConfirmationPreviewResponse,
  OcrConfirmationSaveRequest,
} from '@aiproj/types'

/**
 * OCR 审查确认流——前端 API 客户端（v3-ocr-review-confirmation-flow §7.1）。
 */
export const ocrReviewApi = {
  /** 获取审查详情 */
  review: (projectId: number, jobId: number) =>
    apiFetch<OcrReviewDetailResponse>(`/projects/${projectId}/ocr/document-jobs/${jobId}/review`),

  /** 获取已接受提取列表 */
  acceptedExtractions: (
    projectId: number,
    jobId: number,
    params?: { sourceKind?: string; sourceId?: number; page?: number; perPage?: number },
  ) => {
    const query = new URLSearchParams()
    if (params?.sourceKind) query.set('sourceKind', params.sourceKind)
    if (params?.sourceId) query.set('sourceId', String(params.sourceId))
    if (params?.page) query.set('page', String(params.page))
    if (params?.perPage) query.set('perPage', String(params.perPage))
    const qs = query.toString()
    return apiFetch<{ data: OcrAcceptedExtractionSummary[]; meta: OcrAcceptedExtractionListMeta }>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/accepted-extractions${qs ? `?${qs}` : ''}`,
    )
  },

  /** 确认预览 */
  confirmationPreview: (projectId: number, jobId: number, input: OcrConfirmationPreviewRequest) =>
    apiFetch<OcrConfirmationPreviewResponse>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/confirmation-preview`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 确认保存 */
  confirmationSave: (projectId: number, jobId: number, input: OcrConfirmationSaveRequest) =>
    apiFetch<OcrAcceptedExtractionSummary>(
      `/projects/${projectId}/ocr/document-jobs/${jobId}/confirmation-save`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
}
