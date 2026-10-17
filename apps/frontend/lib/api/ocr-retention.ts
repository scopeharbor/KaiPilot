import { apiFetch } from '@/lib/api-client'
import type {
  OcrRetentionPolicy,
  OcrRetentionPolicyUpdateRequest,
  OcrRetentionStatusResponse,
  OcrCleanupPreviewRequest,
  OcrCleanupPreviewResponse,
  OcrCleanupExecuteRequest,
  OcrCleanupResultDTO,
  OcrRetentionHoldSetRequest,
  OcrRetentionHoldReleaseRequest,
  OcrRetentionHoldDTO,
  OcrAcceptedExtractionRetentionSummary,
} from '@aiproj/types'

/**
 * OCR 保留治理——前端 API 客户端（v3-ocr-result-persistence-and-retention §7.1）。
 */
export const ocrRetentionApi = {
  /** 读取项目 OCR 保留策略 */
  readPolicy: (projectId: number) =>
    apiFetch<{ data: OcrRetentionPolicy }>(`/projects/${projectId}/ocr/retention/policy`),

  /** 更新项目 OCR 保留策略 */
  updatePolicy: (projectId: number, input: OcrRetentionPolicyUpdateRequest) =>
    apiFetch<{ data: OcrRetentionPolicy }>(`/projects/${projectId}/ocr/retention/policy`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** 读取项目 OCR 保留状态 */
  getStatus: (projectId: number) =>
    apiFetch<{ data: OcrRetentionStatusResponse }>(`/projects/${projectId}/ocr/retention/status`),

  /** 获取 accepted extraction 保留摘要列表 */
  getAcceptedExtractions: (projectId: number) =>
    apiFetch<{
      data: OcrAcceptedExtractionRetentionSummary[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/retention/accepted-extractions`),

  /** 清理预览 */
  previewCleanup: (projectId: number, input?: OcrCleanupPreviewRequest) =>
    apiFetch<{ data: OcrCleanupPreviewResponse }>(
      `/projects/${projectId}/ocr/retention/cleanup/preview`,
      { method: 'POST', body: JSON.stringify(input ?? {}) },
    ),

  /** 清理执行 */
  executeCleanup: (projectId: number, input: OcrCleanupExecuteRequest) =>
    apiFetch<{ data: OcrCleanupResultDTO }>(
      `/projects/${projectId}/ocr/retention/cleanup/execute`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 列出 hold */
  listHolds: (projectId: number) =>
    apiFetch<{
      data: OcrRetentionHoldDTO[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/retention/holds`),

  /** 设置 hold */
  setHold: (projectId: number, input: OcrRetentionHoldSetRequest) =>
    apiFetch<{ data: OcrRetentionHoldDTO }>(`/projects/${projectId}/ocr/retention/holds`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 释放 hold */
  releaseHold: (projectId: number, input: OcrRetentionHoldReleaseRequest) =>
    apiFetch<{ data: OcrRetentionHoldDTO }>(
      `/projects/${projectId}/ocr/retention/holds/${input.holdId}`,
      { method: 'DELETE' },
    ),
}
