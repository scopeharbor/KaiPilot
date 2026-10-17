import { useQuery } from '@tanstack/react-query'
import {
  fetchOrganizationDashboard,
  organizationDashboardKeys,
} from '@/lib/api/organization-dashboard'
import { useAuthStore } from '@/stores/auth-store'
import type { OrganizationDashboardQuery } from '@aiproj/types'

/** 当前会话的组织 ID（来自 JWT claims，由 auth-store 解析）。 */
export function useCurrentOrganizationId(): number | null {
  return useAuthStore((state) => state.currentOrganizationId)
}

/**
 * 组织 Dashboard 服务端状态（v3-organization-dashboard §5.1）。
 *
 * 无当前组织时不发请求（`enabled: false`），由页面渲染空态而不是打无效请求。
 */
export function useOrganizationDashboard(query?: OrganizationDashboardQuery) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: organizationDashboardKeys.summary(organizationId, query),
    queryFn: () => fetchOrganizationDashboard(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}
