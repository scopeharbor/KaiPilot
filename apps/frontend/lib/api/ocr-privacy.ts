import { apiFetch } from '@/lib/api-client'
import type {
  OcrPrivacyPolicy,
  OcrPrivacyPolicyOverrideRequest,
  OcrPrivacyStatusSummary,
  OcrPrivacyDecision,
  OcrPrivacyDecisionInput,
  OcrPrivacyCopyExportPreviewInput,
  OcrPrivacyCopyExportPreviewResponse,
  OcrPrivacyCopyExportExecuteInput,
  OcrPrivacyCopyExportRun,
} from '@aiproj/types'

/**
 * OCR 隐私策略控制——前端 API 客户端（v3-ocr-privacy-policy-controls §7.1）
 */
export const ocrPrivacyApi = {
  /** 读取项目 OCR 隐私策略 */
  readPolicy: (projectId: number) =>
    apiFetch<OcrPrivacyPolicy>(`/projects/${projectId}/ocr/privacy/policy`),

  /** 更新项目 OCR 隐私策略 */
  updatePolicy: (projectId: number, input: OcrPrivacyPolicyOverrideRequest) =>
    apiFetch<OcrPrivacyPolicy>(`/projects/${projectId}/ocr/privacy/policy`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** 读取隐私状态 */
  readStatus: (projectId: number) =>
    apiFetch<OcrPrivacyStatusSummary>(`/projects/${projectId}/ocr/privacy/status`),

  /** 隐私决策预览 */
  decisionPreview: (projectId: number, input: OcrPrivacyDecisionInput) =>
    apiFetch<OcrPrivacyDecision>(`/projects/${projectId}/ocr/privacy/decision-preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 导出预览 */
  exportPreview: (projectId: number, input: OcrPrivacyCopyExportPreviewInput) =>
    apiFetch<OcrPrivacyCopyExportPreviewResponse>(
      `/projects/${projectId}/ocr/privacy/export-preview`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 导出执行 */
  exportExecute: (projectId: number, input: OcrPrivacyCopyExportExecuteInput) =>
    apiFetch<OcrPrivacyCopyExportRun>(`/projects/${projectId}/ocr/privacy/export-execute`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 列出运行记录 */
  listRuns: (projectId: number) =>
    apiFetch<{
      data: OcrPrivacyCopyExportRun[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/privacy/runs`),

  /** 获取运行详情 */
  runDetail: (projectId: number, runId: number) =>
    apiFetch<OcrPrivacyCopyExportRun>(`/projects/${projectId}/ocr/privacy/runs/${runId}`),
}
