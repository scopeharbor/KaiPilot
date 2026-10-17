import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  OrganizationDashboardLayout,
  OrganizationDashboardLayoutListResponse,
  OrganizationDashboardLayoutCurrentResponse,
  OrganizationDashboardLayoutPreviewResponse,
  OrganizationDashboardLayoutPayload,
  OrganizationDashboardLayoutPreviewResult,
  OrganizationDashboardLayoutScope,
  OrganizationDashboardLayoutPreviewWarning,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排 API client（v3-organization-dashboard-layout-builder §5.1）。
 *
 * 路由：`/api/v1/organizations/:organizationId/dashboard/layouts/*`
 * 支持列表、当前布局、预览（无副作用）、保存、复制、设为默认、重置、删除。
 */

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const organizationDashboardLayoutKeys = {
  all: ['organizations', 'dashboard', 'layouts'] as const,
  list: (organizationId: number | null) =>
    [...organizationDashboardLayoutKeys.all, organizationId ?? 'none', 'list'] as const,
  current: (organizationId: number | null) =>
    [...organizationDashboardLayoutKeys.all, organizationId ?? 'none', 'current'] as const,
  detail: (organizationId: number | null, layoutId: number | null) =>
    [...organizationDashboardLayoutKeys.all, organizationId ?? 'none', layoutId ?? 'none'] as const,
}

// ─── API ───────────────────────────────────────────────────────────────────────

const BASE = (orgId: number) => `/organizations/${orgId}/dashboard/layouts`

/**
 * 写操作简写：默认 POST，`json` 自动序列化（Content-Type 由 apiFetchEnvelope 依 body 补齐）。
 * 仅本模块使用，故不放进共享 api-client。
 */
async function apiMutation<T = void>(
  path: string,
  options: { method?: 'POST' | 'PUT' | 'DELETE'; json?: unknown } = {},
): Promise<T> {
  const { method = 'POST', json } = options
  return apiFetchEnvelope<T>(path, {
    method,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  })
}

/** 获取所有布局列表。 */
export async function fetchLayoutList(
  organizationId: number,
): Promise<OrganizationDashboardLayout[]> {
  const result = await apiFetchEnvelope<OrganizationDashboardLayoutListResponse>(
    BASE(organizationId),
  )
  return result.data
}

/** 获取当前激活的布局。 */
export async function fetchCurrentLayout(organizationId: number): Promise<{
  layout: OrganizationDashboardLayout
  warnings: OrganizationDashboardLayoutPreviewWarning[]
}> {
  const result = await apiFetchEnvelope<OrganizationDashboardLayoutCurrentResponse>(
    `${BASE(organizationId)}/current`,
  )
  return result.data
}

/** 预览布局（无副作用）。 */
export async function previewLayout(
  organizationId: number,
  payload: OrganizationDashboardLayoutPayload,
): Promise<OrganizationDashboardLayoutPreviewResult> {
  const result = await apiMutation<OrganizationDashboardLayoutPreviewResponse>(
    `${BASE(organizationId)}/preview`,
    { json: payload },
  )
  return result.data
}

/** 保存个人布局。 */
export async function savePersonalLayout(
  organizationId: number,
  payload: OrganizationDashboardLayoutPayload,
): Promise<OrganizationDashboardLayout> {
  const result = await apiMutation<{ data: OrganizationDashboardLayout }>(
    `${BASE(organizationId)}/personal`,
    { json: payload },
  )
  return result.data
}

/** 保存组织共享布局。 */
export async function saveSharedLayout(
  organizationId: number,
  payload: OrganizationDashboardLayoutPayload,
): Promise<OrganizationDashboardLayout> {
  const result = await apiMutation<{ data: OrganizationDashboardLayout }>(
    `${BASE(organizationId)}/shared`,
    { json: payload },
  )
  return result.data
}

/** 复制布局。 */
export async function copyLayout(
  organizationId: number,
  layoutId: number,
  name?: string,
  scope?: OrganizationDashboardLayoutScope,
): Promise<OrganizationDashboardLayout> {
  const result = await apiMutation<{ data: OrganizationDashboardLayout }>(
    `${BASE(organizationId)}/${layoutId}/copy`,
    { json: { name, scope } },
  )
  return result.data
}

/** 设为默认。 */
export async function setDefaultLayout(
  organizationId: number,
  layoutId: number,
  expectedVersion?: number,
): Promise<OrganizationDashboardLayout> {
  const result = await apiMutation<{ data: OrganizationDashboardLayout }>(
    `${BASE(organizationId)}/${layoutId}/default`,
    {
      method: 'PUT',
      json: expectedVersion !== undefined ? { expectedVersion } : {},
    },
  )
  return result.data
}

/** 重置为系统默认。 */
export async function resetLayout(organizationId: number): Promise<OrganizationDashboardLayout> {
  const result = await apiMutation<{ data: OrganizationDashboardLayout }>(
    `${BASE(organizationId)}/reset`,
  )
  return result.data
}

/** 删除布局。 */
export async function deleteLayout(organizationId: number, layoutId: number): Promise<void> {
  await apiMutation(`${BASE(organizationId)}/${layoutId}`, { method: 'DELETE' })
}
