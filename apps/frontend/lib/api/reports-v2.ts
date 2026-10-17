/**
 * report_v2 —— V2 报表工作台前端 API 客户端。
 *
 * 覆盖：模板目录、preview、jobs、versions、exports、download、AI 审核
 */
import type {
  V2ReportTemplateId,
  V2ReportExportFormat,
  V2ListTemplatesResponse,
  V2PreviewRequest,
  V2PreviewResponse,
  V2CreateVersionResponse,
  V2CreateVersionRequest,
  V2ListVersionsResponse,
  V2ListVersionsFilters,
  V2GetJobResponse,
  V2RetryJobResponse,
  V2CreateExportRequest,
  V2CreateExportResponse,
  V2ListExportsResponse,
  V2AiReviewRequest,
  V2AiReviewResponse,
  AiPeriodicPreviewRequest,
  AiPeriodicGenerateRequest,
  AiReviewPeriodicRequest,
  ReportJob,
  ReportVersion,
  ReportExport,
} from '@aiproj/types'
import { apiFetchEnvelope, apiRawFetch } from '@/lib/api-client'

/** V2 报表 API 路径前缀 */
const V2_PATH = (projectId: number) => `/projects/${projectId}/reports/v2`

// ---------------------------------------------------------------------------
// 模板目录
// ---------------------------------------------------------------------------

export async function v2ListTemplates(projectId: number): Promise<V2ListTemplatesResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/templates`)
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function v2Preview(
  projectId: number,
  body: V2PreviewRequest,
): Promise<V2PreviewResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function v2CreateVersion(
  projectId: number,
  body: V2CreateVersionRequest,
): Promise<V2CreateVersionResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function v2ListVersions(
  projectId: number,
  filters: V2ListVersionsFilters = {},
): Promise<V2ListVersionsResponse> {
  const params = new URLSearchParams()
  if (filters.templateId) params.set('templateId', filters.templateId)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  const qs = params.toString()
  return apiFetchEnvelope(`${V2_PATH(projectId)}/versions${qs ? `?${qs}` : ''}`)
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function v2GetJob(projectId: number, jobId: number): Promise<V2GetJobResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/jobs/${jobId}`)
}

export async function v2RetryJob(projectId: number, jobId: number): Promise<V2RetryJobResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/jobs/${jobId}/retry`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export async function v2CreateExport(
  projectId: number,
  versionId: number,
  body: V2CreateExportRequest,
): Promise<V2CreateExportResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/versions/${versionId}/exports`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function v2ListExports(
  projectId: number,
  versionId: number,
): Promise<V2ListExportsResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/versions/${versionId}/exports`)
}

export async function v2DownloadExport(
  projectId: number,
  exportId: number,
): Promise<{ blob: Blob; filename: string }> {
  const path = `${V2_PATH(projectId)}/exports/${exportId}/download`
  const res = await apiRawFetch(path)
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `report-${exportId}`
  return { blob: await res.blob(), filename }
}

// ---------------------------------------------------------------------------
// AI Review
// ---------------------------------------------------------------------------

export async function v2AiReview(
  projectId: number,
  versionId: number,
  body: V2AiReviewRequest,
): Promise<V2AiReviewResponse> {
  return apiFetchEnvelope(`${V2_PATH(projectId)}/versions/${versionId}/ai-review`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// AI 周期报表
// ---------------------------------------------------------------------------

/** AI 周期报表 API 路径前缀 */
const PERIODIC_PATH = (projectId: number) => `/projects/${projectId}/reports/v2/periodic`

export async function v2PeriodicPreview(
  projectId: number,
  body: AiPeriodicPreviewRequest,
): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function v2PeriodicGenerate(
  projectId: number,
  body: AiPeriodicGenerateRequest,
): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function v2PeriodicJob(projectId: number, jobId: number): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/jobs/${jobId}`)
}

export async function v2PeriodicRetryJob(projectId: number, jobId: number): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/jobs/${jobId}/retry`, {
    method: 'POST',
  })
}

export async function v2PeriodicReview(
  projectId: number,
  versionId: number,
  body: AiReviewPeriodicRequest,
): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/versions/${versionId}/review`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function v2PeriodicCreateExport(
  projectId: number,
  versionId: number,
  body: { format: V2ReportExportFormat; draftOverride?: boolean },
): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/versions/${versionId}/exports`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function v2PeriodicListExports(
  projectId: number,
  versionId: number,
): Promise<unknown> {
  return apiFetchEnvelope(`${PERIODIC_PATH(projectId)}/versions/${versionId}/exports`)
}

export async function v2PeriodicDownloadExport(
  projectId: number,
  exportId: number,
): Promise<Response> {
  return apiRawFetch(`${PERIODIC_PATH(projectId)}/exports/${exportId}/download`)
}

export type { V2ReportTemplateId, V2ReportExportFormat, ReportJob, ReportVersion, ReportExport }
