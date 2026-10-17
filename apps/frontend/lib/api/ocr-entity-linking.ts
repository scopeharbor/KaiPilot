import { apiFetch } from '@/lib/api-client'
import type {
  OcrEntityLinkRunSummary,
  OcrEntityLinkRunDetail,
  OcrEntityLinkCandidate,
  OcrEntityLinkPreview,
  OcrEntityLinkConfirmedLink,
  CreateOcrEntityLinkRunRequest,
  ConfirmOcrEntityLinkRequest,
  SupersedeOcrEntityLinkRequest,
  ExplainOcrEntityLinkRequest,
  OcrEntityLinkExplanation,
  OcrEntityLinkListFilters,
} from '@aiproj/types'

/**
 * OCR 实体链接——前端 API 客户端（v3-ocr-entity-linking）。
 */
export const ocrEntityLinkingApi = {
  /** 列出项目的实体链接运行 */
  list: (projectId: number, filters?: OcrEntityLinkListFilters) => {
    const query = new URLSearchParams()
    if (filters?.status) query.set('status', filters.status)
    if (filters?.stale !== undefined) query.set('stale', String(filters.stale))
    if (filters?.page) query.set('page', String(filters.page))
    if (filters?.perPage) query.set('perPage', String(filters.perPage))
    const qs = query.toString()
    return apiFetch<{
      data: OcrEntityLinkRunSummary[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/entity-links${qs ? `?${qs}` : ''}`)
  },

  /** 获取运行详情（含候选） */
  detail: (projectId: number, runId: number) =>
    apiFetch<{ data: OcrEntityLinkRunDetail }>(`/projects/${projectId}/ocr/entity-links/${runId}`),

  /** 获取运行候选分页 */
  candidates: (projectId: number, runId: number, page?: number) => {
    const query = page ? `?page=${page}` : ''
    return apiFetch<{
      data: OcrEntityLinkCandidate[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/entity-links/${runId}/candidates${query}`)
  },

  /** 创建实体链接运行 */
  create: (projectId: number, input: CreateOcrEntityLinkRunRequest) =>
    apiFetch<{ data: OcrEntityLinkRunSummary }>(`/projects/${projectId}/ocr/entity-links`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 预览候选链接 */
  preview: (projectId: number, runId: number, candidateId: number) =>
    apiFetch<{ data: OcrEntityLinkPreview }>(
      `/projects/${projectId}/ocr/entity-links/${runId}/candidates/${candidateId}/preview`,
    ),

  /** 确认实体链接 */
  confirm: (projectId: number, input: ConfirmOcrEntityLinkRequest) =>
    apiFetch<{ data: OcrEntityLinkConfirmedLink }>(
      `/projects/${projectId}/ocr/entity-links/confirm`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 取代已有链接 */
  supersede: (projectId: number, linkId: number, input: SupersedeOcrEntityLinkRequest) =>
    apiFetch<void>(`/projects/${projectId}/ocr/entity-links/${linkId}/supersede`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 拒绝候选链接 */
  reject: (projectId: number, linkId: number, input: SupersedeOcrEntityLinkRequest) =>
    apiFetch<void>(`/projects/${projectId}/ocr/entity-links/${linkId}/reject`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** AI 解释实体链接 */
  explain: (projectId: number, input: ExplainOcrEntityLinkRequest) =>
    apiFetch<{ data: OcrEntityLinkExplanation }>(
      `/projects/${projectId}/ocr/entity-links/explain`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
}
