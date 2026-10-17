import type {
  CreateReportRequest,
  CreateReportResponse,
  ExportReportRequest,
  ExportReportResponse,
  GetReportResponse,
  ListReportsResponse,
  Report,
  ReportExportFormat,
  ReportTemplate,
} from '@aiproj/types'
import { apiFetchEnvelope, apiRawFetch, API_BASE_URL } from '@/lib/api-client'

/**
 * preset-project-reports —— 前端 API 客户端（tasks 6.1）。
 *
 * 与后端 `/api/v1/projects/:projectId/reports` 组和扁平 `/api/v1/reports/:id`
 * 组对齐；下载走 `apiRawFetch` 拿 Response 后转 blob，避免 apiFetch 尝试
 * 解析 JSON 破坏文件流。
 */

export interface ReportListFilters {
  template?: ReportTemplate
  generatedBy?: number
  fromDate?: string
  toDate?: string
  sort?: string
  page?: number
  perPage?: number
}

function qs(filters: ReportListFilters): string {
  const params = new URLSearchParams()
  if (filters.template) params.set('template', filters.template)
  if (filters.generatedBy) params.set('generatedBy', String(filters.generatedBy))
  if (filters.fromDate) params.set('fromDate', filters.fromDate)
  if (filters.toDate) params.set('toDate', filters.toDate)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  const s = params.toString()
  return s ? `?${s}` : ''
}

/**
 * 获取项目报表历史（分页）。
 */
export async function listReports(
  projectId: number,
  filters: ReportListFilters = {},
): Promise<ListReportsResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/reports${qs(filters)}`)
}

/**
 * 获取报表详情（读取已保存的 data_snapshot）。
 */
export async function getReport(reportId: number): Promise<GetReportResponse> {
  return apiFetchEnvelope(`/reports/${reportId}`)
}

/**
 * 生成一次预设模板报表。
 */
export async function createReport(
  projectId: number,
  body: CreateReportRequest,
): Promise<CreateReportResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/reports`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * 触发导出（Markdown / CSV）。返回的 downloadUrl 是绝对到 /api/v1 的路径，
 * 由 Controller 拼装。
 */
export async function exportReport(
  reportId: number,
  body: ExportReportRequest,
): Promise<ExportReportResponse> {
  return apiFetchEnvelope(`/reports/${reportId}/exports`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * 下载已导出的文件：走 apiRawFetch 拿 Response，交由调用方触发浏览器保存。
 * 不使用 apiFetch —— 后者会尝试解析 JSON，破坏文件流。
 */
export async function downloadReportFile(
  reportId: number,
  format: ReportExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  // Controller 返回的 downloadUrl 是相对 API_BASE_URL 的子路径。
  const path = `/reports/${reportId}/exports/${format}/download`
  const res = await apiRawFetch(path)
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = match && match[1] ? decodeURIComponent(match[1]) : `report-${reportId}.${format}`
  const blob = await res.blob()
  return { blob, filename }
}

/**
 * 拼装完整下载 URL（供 <a href> 直链使用；如需 auth 走 downloadReportFile）。
 */
export function reportDownloadUrl(reportId: number, format: ReportExportFormat): string {
  return `${API_BASE_URL}/reports/${reportId}/exports/${format}/download`
}

export type { Report, ReportTemplate, ReportExportFormat }
