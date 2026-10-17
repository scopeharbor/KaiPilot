// v3-bi-dashboard-builder §8.1 — BI Dashboard Builder 前端 API client。
// registry、definitions、current、preview、create/update/copy/default/archive/restore。

import type {
  BiDashboardRegistryResponse,
  BiDashboardListResponse,
  BiDashboardDetailResponse,
  BiDashboardPreviewResult,
  BiDashboardCreatePayload,
  BiDashboardUpdatePayload,
  BiDashboardPreviewPayload,
} from '@aiproj/types'
import { apiFetchEnvelope } from '@/lib/api-client'

// 路径相对 API_BASE_URL（已含 /api/v1），故此处不再重复前缀。
const basePath = (organizationId: number) => `/organizations/${organizationId}/bi/dashboards`

/** POST/PUT 统一序列化，Content-Type 由 apiFetchEnvelope 依 body 自动补。 */
function jsonInit(method: 'POST' | 'PUT', payload?: unknown): RequestInit {
  return payload === undefined ? { method } : { method, body: JSON.stringify(payload) }
}

// ─── Registry ──────────────────────────────────────────────────────────────

export async function fetchWidgetRegistry(
  organizationId: number,
): Promise<BiDashboardRegistryResponse> {
  return apiFetchEnvelope<BiDashboardRegistryResponse>(`${basePath(organizationId)}/registry`)
}

// ─── List ──────────────────────────────────────────────────────────────────

export async function fetchDashboardList(
  organizationId: number,
  params?: { page?: number; perPage?: number; scope?: string; includeArchived?: boolean },
): Promise<BiDashboardListResponse> {
  const sp = new URLSearchParams()
  if (params?.page !== undefined) sp.set('page', String(params.page))
  if (params?.perPage !== undefined) sp.set('perPage', String(params.perPage))
  if (params?.scope) sp.set('scope', params.scope)
  if (params?.includeArchived !== undefined) {
    sp.set('includeArchived', String(params.includeArchived))
  }
  const qs = sp.toString()
  return apiFetchEnvelope<BiDashboardListResponse>(
    `${basePath(organizationId)}${qs ? `?${qs}` : ''}`,
  )
}

// ─── Current ───────────────────────────────────────────────────────────────

export async function fetchCurrentDashboard(
  organizationId: number,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(`${basePath(organizationId)}/current`)
}

// ─── Detail ────────────────────────────────────────────────────────────────

export async function fetchDashboardDetail(
  organizationId: number,
  dashboardId: number,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(`${basePath(organizationId)}/${dashboardId}`)
}

// ─── Preview ───────────────────────────────────────────────────────────────

export async function previewDashboard(
  organizationId: number,
  payload: BiDashboardPreviewPayload,
): Promise<{ data: BiDashboardPreviewResult }> {
  return apiFetchEnvelope<{ data: BiDashboardPreviewResult }>(
    `${basePath(organizationId)}/preview`,
    jsonInit('POST', payload),
  )
}

// ─── Create ────────────────────────────────────────────────────────────────

export async function createDashboard(
  organizationId: number,
  payload: BiDashboardCreatePayload,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(
    basePath(organizationId),
    jsonInit('POST', payload),
  )
}

// ─── Update ────────────────────────────────────────────────────────────────

export async function updateDashboard(
  organizationId: number,
  dashboardId: number,
  payload: BiDashboardUpdatePayload,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(
    `${basePath(organizationId)}/${dashboardId}`,
    jsonInit('PUT', payload),
  )
}

// ─── Copy ──────────────────────────────────────────────────────────────────

export async function copyDashboard(
  organizationId: number,
  dashboardId: number,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(
    `${basePath(organizationId)}/${dashboardId}/copy`,
    jsonInit('POST'),
  )
}

// ─── Set Default ───────────────────────────────────────────────────────────

export async function setDefaultDashboard(
  organizationId: number,
  dashboardId: number,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(
    `${basePath(organizationId)}/${dashboardId}/set-default`,
    jsonInit('POST'),
  )
}

// ─── Archive ───────────────────────────────────────────────────────────────

export async function archiveDashboard(
  organizationId: number,
  dashboardId: number,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(
    `${basePath(organizationId)}/${dashboardId}/archive`,
    jsonInit('POST'),
  )
}

// ─── Restore ───────────────────────────────────────────────────────────────

export async function restoreDashboard(
  organizationId: number,
  dashboardId: number,
): Promise<BiDashboardDetailResponse> {
  return apiFetchEnvelope<BiDashboardDetailResponse>(
    `${basePath(organizationId)}/${dashboardId}/restore`,
    jsonInit('POST'),
  )
}

// ─── Delete ────────────────────────────────────────────────────────────────

export async function deleteDashboard(organizationId: number, dashboardId: number): Promise<void> {
  await apiFetchEnvelope<void>(`${basePath(organizationId)}/${dashboardId}`, {
    method: 'DELETE',
  })
}
