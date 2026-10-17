import { apiFetch } from '@/lib/api-client'
import type {
  OcrSearchIndexListResponse,
  OcrSearchIndexListQuery,
  OcrSearchIndexPreviewRequest,
  OcrSearchIndexPreviewResponse,
  OcrSearchIndexExecuteRequest,
  OcrSearchIndexExecuteResponse,
  OcrSearchIndexReindexRequest,
  OcrSearchIndexUnindexRequest,
} from '@aiproj/types'

/**
 * OCR 搜索索引——前端 API 客户端（v3-ocr-document-search-indexing §8.1）。
 */
export const ocrSearchIndexApi = {
  /** 列出项目 OCR 搜索索引状态 */
  list: (projectId: number, params?: OcrSearchIndexListQuery) => {
    const searchParams = new URLSearchParams()
    if (params?.sourceKind) searchParams.set('sourceKind', params.sourceKind)
    if (params?.sourceId) searchParams.set('sourceId', String(params.sourceId))
    if (params?.extractionId) searchParams.set('extractionId', String(params.extractionId))
    if (params?.status) searchParams.set('status', params.status)
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.perPage) searchParams.set('perPage', String(params.perPage))
    const qs = searchParams.toString()
    return apiFetch<OcrSearchIndexListResponse>(
      `/projects/${projectId}/ocr/search-index${qs ? `?${qs}` : ''}`,
    )
  },

  /** 预览索引计划 */
  preview: (projectId: number, input: OcrSearchIndexPreviewRequest) =>
    apiFetch<OcrSearchIndexPreviewResponse>(`/projects/${projectId}/ocr/search-index/preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 执行索引 */
  execute: (projectId: number, input: OcrSearchIndexExecuteRequest) =>
    apiFetch<OcrSearchIndexExecuteResponse>(`/projects/${projectId}/ocr/search-index/execute`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 重新索引预览 */
  reindexPreview: (projectId: number, input: OcrSearchIndexReindexRequest) =>
    apiFetch<OcrSearchIndexPreviewResponse>(
      `/projects/${projectId}/ocr/search-index/reindex-preview`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 执行重新索引 */
  reindexExecute: (projectId: number, input: OcrSearchIndexExecuteRequest) =>
    apiFetch<OcrSearchIndexExecuteResponse>(
      `/projects/${projectId}/ocr/search-index/reindex-execute`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 取消索引预览 */
  unindexPreview: (projectId: number, input: OcrSearchIndexUnindexRequest) =>
    apiFetch<OcrSearchIndexPreviewResponse>(
      `/projects/${projectId}/ocr/search-index/unindex-preview`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 执行取消索引 */
  unindexExecute: (
    projectId: number,
    input: OcrSearchIndexExecuteRequest & OcrSearchIndexUnindexRequest,
  ) =>
    apiFetch<OcrSearchIndexExecuteResponse>(
      `/projects/${projectId}/ocr/search-index/unindex-execute`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
}
