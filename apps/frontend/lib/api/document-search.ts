/**
 * 文档搜索索引管理 API client（v3-document-full-text-search §10.4）
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type { DocumentSearchStatus, DocumentSearchRebuildResult } from '@aiproj/types'

export interface DocumentSearchStatusResponse {
  // 可为 null：项目还没建过索引时后端返回空 data，面板据此渲染空态。
  data: DocumentSearchStatus | null
}

export interface DocumentSearchRebuildResponse {
  data: DocumentSearchRebuildResult
}

export const documentSearchApi = {
  status: (projectId: number) =>
    apiFetchEnvelope<DocumentSearchStatusResponse>(
      `/projects/${projectId}/document-search/status`,
      { method: 'GET' },
    ),

  reindex: (projectId: number, full = false) =>
    apiFetchEnvelope<DocumentSearchRebuildResponse>(
      `/projects/${projectId}/document-search/reindex`,
      {
        method: 'POST',
        body: JSON.stringify({ full }),
        headers: { 'Content-Type': 'application/json' },
      },
    ),
}

export const documentSearchKeys = {
  all: ['document-search'] as const,
  status: (projectId: number) => [...documentSearchKeys.all, 'status', projectId] as const,
}
