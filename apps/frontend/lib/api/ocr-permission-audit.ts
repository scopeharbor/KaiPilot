import { apiFetch } from '@/lib/api-client'
import type {
  OcrPermissionStatus,
  OcrDecisionPreview,
  OcrPermissionAction,
  OcrAuditSummary,
  OcrPaginationMeta,
} from '@aiproj/types'

/**
 * OCR 权限/审计——前端 API 客户端（v3-ocr-permission-and-audit §7.1）。
 *
 * 端点位于 /api/v1/projects/:projectId/ocr/permission-audit 下：
 * - GET  /status            权限状态（低敏）
 * - POST /decision-preview  单动作决策预览（服务端重验证）
 * - GET  /audit-summaries   只读审计摘要（有界分页 + 过滤）
 *
 * 红线：前端允许动作声明一律忽略，仅以服务端 resolver 输出为准（§5.5）。
 */
export interface OcrPermissionStatusQuery {
  sourceRefId?: number
  sourceRefKind?: string
  artifactRefId?: number
  artifactRefKind?: string
}

export interface OcrDecisionPreviewRequest {
  action: OcrPermissionAction
  sourceRefId?: number
  sourceRefKind?: string
  artifactRefId?: number
  artifactRefKind?: string
  sourceHash?: string
}

export interface OcrAuditSummaryQueryInput {
  actorId?: number
  action?: OcrPermissionAction
  result?: string
  reasonCode?: string
  from?: string
  to?: string
  page?: number
  perPage?: number
}

export interface OcrAuditSummaryPage {
  data: OcrAuditSummary[]
  meta: OcrPaginationMeta
}

export const ocrPermissionAuditApi = {
  /** 读取项目 OCR 权限状态（低敏：仅哈希/引用/枚举码/原因码） */
  getStatus: (projectId: number, query?: OcrPermissionStatusQuery) => {
    const qs = new URLSearchParams()
    if (query?.sourceRefId) qs.set('sourceRefId', String(query.sourceRefId))
    if (query?.sourceRefKind) qs.set('sourceRefKind', query.sourceRefKind)
    if (query?.artifactRefId) qs.set('artifactRefId', String(query.artifactRefId))
    if (query?.artifactRefKind) qs.set('artifactRefKind', query.artifactRefKind)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<{ data: OcrPermissionStatus }>(
      `/projects/${projectId}/ocr/permission-audit/status${suffix}`,
    )
  },

  /** 单动作决策预览（服务端重验证，拒绝时写低敏边界审计） */
  previewDecision: (projectId: number, input: OcrDecisionPreviewRequest) =>
    apiFetch<{ data: OcrDecisionPreview }>(
      `/projects/${projectId}/ocr/permission-audit/decision-preview`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 只读审计摘要查询（有界分页 + 过滤） */
  queryAuditSummaries: (projectId: number, query: OcrAuditSummaryQueryInput) => {
    const qs = new URLSearchParams()
    if (query.actorId) qs.set('actorId', String(query.actorId))
    if (query.action) qs.set('action', query.action)
    if (query.result) qs.set('result', query.result)
    if (query.reasonCode) qs.set('reasonCode', query.reasonCode)
    if (query.from) qs.set('from', query.from)
    if (query.to) qs.set('to', query.to)
    if (query.page) qs.set('page', String(query.page))
    if (query.perPage) qs.set('perPage', String(query.perPage))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<OcrAuditSummaryPage>(
      `/projects/${projectId}/ocr/permission-audit/audit-summaries${suffix}`,
    )
  },
}

export type { OcrPermissionStatus, OcrDecisionPreview, OcrAuditSummary }
