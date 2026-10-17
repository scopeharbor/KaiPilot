import { apiFetchEnvelope } from '@/lib/api-client'
import type { OrganizationDashboardQuery, OrganizationDashboardSummary } from '@aiproj/types'

/**
 * 组织级 Dashboard API client（v3-organization-dashboard §5.1）。
 *
 * 只读：仅 GET，无 mutation。组织 ID 显式带在路径上，与后端
 * `/api/v1/organizations/:organizationId/dashboard` 契约一致。
 */

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const organizationDashboardKeys = {
  all: ['organizations', 'dashboard'] as const,
  summary: (organizationId: number | null, query?: OrganizationDashboardQuery) =>
    [...organizationDashboardKeys.all, organizationId ?? 'none', query ?? {}] as const,
}

// ─── API ───────────────────────────────────────────────────────────────────────

function buildQueryString(query?: OrganizationDashboardQuery): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  if (query.sections?.length) sp.set('sections', query.sections.join(','))
  if (query.attentionLimit) sp.set('attentionLimit', String(query.attentionLimit))
  if (query.activityLimit) sp.set('activityLimit', String(query.activityLimit))
  if (query.freshnessWindowMinutes) {
    sp.set('freshnessWindowMinutes', String(query.freshnessWindowMinutes))
  }
  if (query.dueSoonDays) sp.set('dueSoonDays', String(query.dueSoonDays))
  if (query.attentionSort) sp.set('attentionSort', query.attentionSort)
  if (query.attentionOrder) sp.set('attentionOrder', query.attentionOrder)
  if (query.filterStatus) sp.set('filterStatus', query.filterStatus)
  if (query.filterHealth) sp.set('filterHealth', query.filterHealth)
  if (query.search) sp.set('search', query.search)
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

/** 读取组织 Dashboard 摘要。 */
export async function fetchOrganizationDashboard(
  organizationId: number,
  query?: OrganizationDashboardQuery,
): Promise<OrganizationDashboardSummary> {
  const result = await apiFetchEnvelope<{ data: OrganizationDashboardSummary }>(
    `/organizations/${organizationId}/dashboard${buildQueryString(query)}`,
  )
  return result.data
}
