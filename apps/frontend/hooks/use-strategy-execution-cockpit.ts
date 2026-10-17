import { useQuery } from '@tanstack/react-query'
import {
  fetchStrategyExecutionCockpit,
  strategyExecutionCockpitKeys,
} from '@/lib/api/strategy-execution-cockpit'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import type { CockpitQuery } from '@aiproj/types'

/**
 * 战略执行驾驶舱服务端状态（v3-strategy-execution-cockpit §5.1）。
 *
 * 无当前组织时不发请求（enabled: false），由页面渲染空态而不是打无效请求。
 * query key 绑定 organization / cycle / 规范化 filters，保证缓存隔离与 stale 响应不覆盖新 query。
 */
export function useStrategyExecutionCockpit(query?: CockpitQuery, options?: { enabled?: boolean }) {
  const organizationId = useCurrentOrganizationId()

  return useQuery({
    queryKey: strategyExecutionCockpitKeys.summary(organizationId, query),
    queryFn: () => fetchStrategyExecutionCockpit(organizationId as number, query),
    enabled: (options?.enabled ?? true) && organizationId !== null,
    staleTime: 60_000,
  })
}
