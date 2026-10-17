import { apiFetch } from '@/lib/api-client'
import type {
  OcrExtractionProfileSummary,
  OcrExtractionProfileDetail,
  CreateOcrExtractionProfileRequest,
  UpdateOcrExtractionProfileRequest,
  OcrExtractionRunSummary,
  OcrExtractionRunDetail,
  CreateOcrExtractionRunRequest,
  ListOcrExtractionRunsFilter,
  OcrFieldCandidate,
  OcrTableCandidate,
  OcrStructuredExtractionPreviewRequest,
  OcrStructuredExtractionPreviewResponse,
  OcrStructuredExtractionSaveRequest,
  OcrStructuredSnapshotSummary,
  OcrStructuredSnapshotDetail,
} from '@aiproj/types'

/**
 * OCR 结构化提取——前端 API 客户端（v3-ocr-structured-extraction §6.1）。
 */
export const ocrStructuredExtractionApi = {
  // ── Profiles ──────────────────────────────────────────────────────

  /** 列出提取 profile */
  listProfiles: (
    projectId: number,
    params?: { scope?: string; status?: string; page?: number; perPage?: number },
  ) => {
    const searchParams = new URLSearchParams()
    if (params?.scope) searchParams.set('scope', params.scope)
    if (params?.status) searchParams.set('status', params.status)
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.perPage) searchParams.set('perPage', String(params.perPage))
    const qs = searchParams.toString()
    return apiFetch<{
      data: OcrExtractionProfileSummary[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/structured-extraction/profiles${qs ? `?${qs}` : ''}`)
  },

  /** 获取 profile 详情 */
  getProfile: (projectId: number, profileId: number) =>
    apiFetch<{ data: OcrExtractionProfileDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/profiles/${profileId}`,
    ),

  /** 创建 profile */
  createProfile: (projectId: number, input: CreateOcrExtractionProfileRequest) =>
    apiFetch<{ data: OcrExtractionProfileDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/profiles`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 更新 profile */
  updateProfile: (projectId: number, profileId: number, input: UpdateOcrExtractionProfileRequest) =>
    apiFetch<{ data: OcrExtractionProfileDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/profiles/${profileId}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),

  /** 归档 profile */
  archiveProfile: (projectId: number, profileId: number) =>
    apiFetch<{ data: OcrExtractionProfileSummary }>(
      `/projects/${projectId}/ocr/structured-extraction/profiles/${profileId}/archive`,
      { method: 'PATCH' },
    ),

  // ── Runs ──────────────────────────────────────────────────────────

  /** 创建提取运行 */
  createRun: (projectId: number, input: CreateOcrExtractionRunRequest) =>
    apiFetch<{ data: OcrExtractionRunDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/runs`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 列出运行 */
  listRuns: (projectId: number, params?: ListOcrExtractionRunsFilter) => {
    const searchParams = new URLSearchParams()
    if (params?.extractionId) searchParams.set('extractionId', String(params.extractionId))
    if (params?.profileId) searchParams.set('profileId', String(params.profileId))
    if (params?.status) searchParams.set('status', params.status)
    if (params?.provenance) searchParams.set('provenance', params.provenance)
    if (params?.sort) searchParams.set('sort', params.sort)
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.perPage) searchParams.set('perPage', String(params.perPage))
    const qs = searchParams.toString()
    return apiFetch<{
      data: OcrExtractionRunSummary[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/structured-extraction/runs${qs ? `?${qs}` : ''}`)
  },

  /** 获取运行详情 */
  getRun: (projectId: number, runId: number) =>
    apiFetch<{ data: OcrExtractionRunDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/runs/${runId}`,
    ),

  /** 获取运行候选 */
  getCandidates: (projectId: number, runId: number) =>
    apiFetch<{ data: { fields: OcrFieldCandidate[]; tables: OcrTableCandidate[] } }>(
      `/projects/${projectId}/ocr/structured-extraction/runs/${runId}/candidates`,
    ),

  // ── Confirmation ──────────────────────────────────────────────────

  /** 确认预览 */
  previewConfirmation: (projectId: number, input: OcrStructuredExtractionPreviewRequest) =>
    apiFetch<{ data: OcrStructuredExtractionPreviewResponse }>(
      `/projects/${projectId}/ocr/structured-extraction/preview`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 保存确认 */
  saveConfirmation: (projectId: number, input: OcrStructuredExtractionSaveRequest) =>
    apiFetch<{ data: OcrStructuredSnapshotDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/save`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  // ── Snapshots ─────────────────────────────────────────────────────

  /** 列出快照 */
  listSnapshots: (
    projectId: number,
    params?: { extractionId?: number; profileId?: number; page?: number; perPage?: number },
  ) => {
    const searchParams = new URLSearchParams()
    if (params?.extractionId) searchParams.set('extractionId', String(params.extractionId))
    if (params?.profileId) searchParams.set('profileId', String(params.profileId))
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.perPage) searchParams.set('perPage', String(params.perPage))
    const qs = searchParams.toString()
    return apiFetch<{
      data: OcrStructuredSnapshotSummary[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`/projects/${projectId}/ocr/structured-extraction/snapshots${qs ? `?${qs}` : ''}`)
  },

  /** 获取快照详情 */
  getSnapshot: (projectId: number, snapshotId: number) =>
    apiFetch<{ data: OcrStructuredSnapshotDetail }>(
      `/projects/${projectId}/ocr/structured-extraction/snapshots/${snapshotId}`,
    ),
}
