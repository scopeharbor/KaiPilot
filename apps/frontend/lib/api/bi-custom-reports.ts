/**
 * BI 自定义报表构建器 API client（v3-bi-custom-report-builder §8.1）。
 *
 * 对应后端端点：
 *   GET    /api/v1/organizations/:orgId/bi/custom-reports/registry
 *   POST   /api/v1/organizations/:orgId/bi/custom-reports/preview
 *   GET    /api/v1/organizations/:orgId/bi/custom-reports/definitions
 *   POST   /api/v1/organizations/:orgId/bi/custom-reports/definitions
 *   GET    /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId
 *   PUT    /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId
 *   POST   /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId/copy
 *   POST   /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId/set-default
 *   POST   /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId/archive
 *   POST   /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId/restore
 *   GET    /api/v1/organizations/:orgId/bi/custom-reports/definitions/:defId/versions
 */
import { api, unwrap } from './_base'
import type {
  BiCustomReportDataSourceDef,
  BiCustomReportPreviewResult,
  BiCustomReportDefinition,
  BiCustomReportVersionEntry,
  BiCustomReportApiMeta,
} from '@aiproj/types'

const prefix = (orgId: number | string) => `/organizations/${orgId}/bi/custom-reports`

// ─── Registry ──────────────────────────────────────────────────────────────

export interface ListRegistryResponse {
  data: BiCustomReportDataSourceDef[]
  meta: { total: number }
}

export async function listRegistry(orgId: number): Promise<ListRegistryResponse> {
  return api.get<ListRegistryResponse>(`${prefix(orgId)}/registry`).then(unwrap)
}

// ─── Preview ───────────────────────────────────────────────────────────────

export interface PreviewInput {
  title?: string
  scope?: string
  dataSources: Array<{ sourceKey: string; alias?: string; label?: string }>
  fields: string[]
  filters?: Array<{ fieldKey: string; operator: string; value: unknown; label?: string }>
  groups?: Array<{ fieldKey: string; label?: string }>
  sorts?: Array<{ fieldKey: string; direction: string; label?: string }>
  visualizations: Array<{
    type: string
    title?: string
    xField?: string
    yField?: string
    seriesField?: string
  }>
  layout?: Record<string, unknown>
}

export interface PreviewResponse {
  data: BiCustomReportPreviewResult
}

export async function previewDefinition(
  orgId: number,
  input: PreviewInput,
): Promise<PreviewResponse> {
  return api.post<PreviewResponse>(`${prefix(orgId)}/preview`, input).then(unwrap)
}

// ─── Definitions ───────────────────────────────────────────────────────────

export interface ListDefinitionsResponse {
  data: BiCustomReportDefinition[]
  meta: BiCustomReportApiMeta
}

export interface GetDefinitionResponse {
  data: BiCustomReportDefinition
}

export interface CreateDefinitionInput {
  title: string
  description?: string
  scope?: string
  visibility?: string
  projectId?: number
  portfolioId?: number
  dataSources: Array<{ sourceKey: string; alias?: string; label?: string }>
  fields: string[]
  filters?: Array<{ fieldKey: string; operator: string; value: unknown; label?: string }>
  groups?: Array<{ fieldKey: string; label?: string }>
  sorts?: Array<{ fieldKey: string; direction: string; label?: string }>
  visualizations: Array<{
    type: string
    title?: string
    xField?: string
    yField?: string
    seriesField?: string
  }>
  layout?: Record<string, unknown>
}

export interface UpdateDefinitionInput extends Partial<CreateDefinitionInput> {
  expectedVersion: number
}

export interface ListVersionsResponse {
  data: BiCustomReportVersionEntry[]
}

export async function listDefinitions(
  orgId: number,
  params?: {
    page?: number
    perPage?: number
    scope?: string
    visibility?: string
    search?: string
    sort?: string
    includeArchived?: boolean
    projectId?: number
    portfolioId?: number
  },
): Promise<ListDefinitionsResponse> {
  const qs = new URLSearchParams()
  if (params?.page) qs.set('page', String(params.page))
  if (params?.perPage) qs.set('perPage', String(params.perPage))
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.visibility) qs.set('visibility', params.visibility)
  if (params?.search) qs.set('search', params.search)
  if (params?.sort) qs.set('sort', params.sort)
  if (params?.includeArchived) qs.set('includeArchived', 'true')
  if (params?.projectId) qs.set('projectId', String(params.projectId))
  if (params?.portfolioId) qs.set('portfolioId', String(params.portfolioId))
  const q = qs.toString()
  return api
    .get<ListDefinitionsResponse>(`${prefix(orgId)}/definitions${q ? `?${q}` : ''}`)
    .then(unwrap)
}

export async function getDefinition(
  orgId: number,
  definitionId: string,
): Promise<GetDefinitionResponse> {
  return api.get<GetDefinitionResponse>(`${prefix(orgId)}/definitions/${definitionId}`).then(unwrap)
}

export async function createDefinition(
  orgId: number,
  input: CreateDefinitionInput,
): Promise<GetDefinitionResponse> {
  return api.post<GetDefinitionResponse>(`${prefix(orgId)}/definitions`, input).then(unwrap)
}

export async function updateDefinition(
  orgId: number,
  definitionId: string,
  input: UpdateDefinitionInput,
): Promise<GetDefinitionResponse> {
  return api
    .put<GetDefinitionResponse>(`${prefix(orgId)}/definitions/${definitionId}`, input)
    .then(unwrap)
}

export async function copyDefinition(
  orgId: number,
  definitionId: string,
  input?: { title?: string; scope?: string; visibility?: string },
): Promise<GetDefinitionResponse> {
  return api
    .post<GetDefinitionResponse>(`${prefix(orgId)}/definitions/${definitionId}/copy`, input ?? {})
    .then(unwrap)
}

export async function setDefaultDefinition(
  orgId: number,
  definitionId: string,
  expectedVersion: number,
): Promise<{ data: { success: boolean } }> {
  return api
    .post<{ data: { success: boolean } }>(
      `${prefix(orgId)}/definitions/${definitionId}/set-default`,
      { expectedVersion },
    )
    .then(unwrap)
}

export async function archiveDefinition(
  orgId: number,
  definitionId: string,
  expectedVersion: number,
): Promise<{ data: { success: boolean } }> {
  return api
    .post<{ data: { success: boolean } }>(`${prefix(orgId)}/definitions/${definitionId}/archive`, {
      expectedVersion,
    })
    .then(unwrap)
}

export async function restoreDefinition(
  orgId: number,
  definitionId: string,
  expectedVersion: number,
): Promise<{ data: { success: boolean } }> {
  return api
    .post<{ data: { success: boolean } }>(`${prefix(orgId)}/definitions/${definitionId}/restore`, {
      expectedVersion,
    })
    .then(unwrap)
}

export async function listVersions(
  orgId: number,
  definitionId: string,
): Promise<ListVersionsResponse> {
  return api
    .get<ListVersionsResponse>(`${prefix(orgId)}/definitions/${definitionId}/versions`)
    .then(unwrap)
}
