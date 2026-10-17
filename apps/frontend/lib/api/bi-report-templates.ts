/**
 * BI 报表模板库 API client（v3-bi-report-template-library §6.1）。
 *
 * 对应后端端点：
 *   GET    /api/v1/organizations/:organizationId/bi/report-templates
 *   GET    /api/v1/organizations/:organizationId/bi/report-templates/:templateId
 *   GET    /api/v1/organizations/:organizationId/bi/report-templates/:templateId/preview
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/:templateId/instantiate
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy
 *   PATCH  /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/archive
 *   POST   /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/restore
 */
import { api, unwrap } from './_base'
import type {
  BiListTemplatesResponse,
  BiGetTemplateResponse,
  BiPreviewTemplateResponse,
  BiInstantiateResponse,
  BiInstantiateRequest,
  BiSaveCopyResponse,
  BiSaveCopyRequest,
  BiUpdateCopyResponse,
  BiUpdateCopyRequest,
  BiArchiveCopyResponse,
  BiRestoreCopyResponse,
} from '@aiproj/types'

const prefix = (organizationId: number | string) =>
  `/organizations/${organizationId}/bi/report-templates`

// ─── 只读端点 ───────────────────────────────────────────────────────────────

/** 获取模板目录列表 */
export async function listBiTemplates(
  organizationId: number,
  params?: { category?: string; page?: number; perPage?: number },
): Promise<BiListTemplatesResponse> {
  const qs = new URLSearchParams()
  if (params?.category) qs.set('category', params.category)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.perPage) qs.set('perPage', String(params.perPage))
  const q = qs.toString()
  return api
    .get(`${prefix(organizationId)}${q ? `?${q}` : ''}`)
    .json<BiListTemplatesResponse>()
    .then(unwrap)
}

/** 获取单个模板详情 */
export async function getBiTemplate(
  organizationId: number,
  templateId: string,
): Promise<BiGetTemplateResponse> {
  return api
    .get(`${prefix(organizationId)}/${templateId}`)
    .json<BiGetTemplateResponse>()
    .then(unwrap)
}

/** 获取模板预览 */
export async function previewBiTemplate(
  organizationId: number,
  templateId: string,
): Promise<BiPreviewTemplateResponse> {
  return api
    .get(`${prefix(organizationId)}/${templateId}/preview`)
    .json<BiPreviewTemplateResponse>()
    .then(unwrap)
}

// ─── 实例化 ─────────────────────────────────────────────────────────────────

/** 从模板创建实例 */
export async function instantiateBiTemplate(
  organizationId: number,
  templateId: string,
  body: BiInstantiateRequest,
): Promise<BiInstantiateResponse> {
  return api
    .post(`${prefix(organizationId)}/${templateId}/instantiate`, { json: body })
    .json<BiInstantiateResponse>()
    .then(unwrap)
}

// ─── 自定义副本写路径 ──────────────────────────────────────────────────────

/** 另存为自定义模板副本 */
export async function saveBiTemplateCopy(
  organizationId: number,
  templateId: string,
  body: BiSaveCopyRequest,
): Promise<BiSaveCopyResponse> {
  return api
    .post(`${prefix(organizationId)}/${templateId}/copy`, { json: body })
    .json<BiSaveCopyResponse>()
    .then(unwrap)
}

/** 更新自定义模板副本 */
export async function updateBiTemplateCopy(
  organizationId: number,
  copyId: number,
  body: BiUpdateCopyRequest,
): Promise<BiUpdateCopyResponse> {
  return api
    .patch(`${prefix(organizationId)}/copies/${copyId}`, { json: body })
    .json<BiUpdateCopyResponse>()
    .then(unwrap)
}

/** 归档自定义模板副本 */
export async function archiveBiTemplateCopy(
  organizationId: number,
  copyId: number,
): Promise<BiArchiveCopyResponse> {
  return api
    .post(`${prefix(organizationId)}/copies/${copyId}/archive`)
    .json<BiArchiveCopyResponse>()
    .then(unwrap)
}

/** 恢复自定义模板副本 */
export async function restoreBiTemplateCopy(
  organizationId: number,
  copyId: number,
): Promise<BiRestoreCopyResponse> {
  return api
    .post(`${prefix(organizationId)}/copies/${copyId}/restore`)
    .json<BiRestoreCopyResponse>()
    .then(unwrap)
}
