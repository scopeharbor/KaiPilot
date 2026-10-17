import { useQuery } from '@tanstack/react-query'
import {
  fetchProjectHealthRiskCommandCenter,
  commandCenterKeys,
} from '@/lib/api/project-health-risk-command-center'
import { queryRetry } from '@/lib/api-client'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import type { CommandCenterQuery } from '@aiproj/types'

/**
 * 项目健康风险指挥中心服务端状态（§5.3）。
 *
 * - 无有效组织或项目 id 时 enabled=false（不发无效请求）；
 * - query key 绑定 有效组织 + 项目 + 规范化 query + contract version，
 *   切换组织/项目不复用缓存；
 * - staleTime 短生命周期（30s）：态势面要求新鲜，显式 refetch 供手动刷新；
 * - 只读 hook：不包含任何 mutation function。
 */
export function useProjectHealthRiskCommandCenter(
  projectId: number | null,
  query?: CommandCenterQuery,
) {
  const organizationId = useCurrentOrganizationId()
  const enabled =
    organizationId !== null && projectId !== null && Number.isFinite(projectId) && projectId > 0

  return useQuery({
    queryKey: commandCenterKeys.summary(organizationId, projectId, query),
    queryFn: () => fetchProjectHealthRiskCommandCenter(projectId as number, query),
    enabled,
    staleTime: 30_000,
    retry: queryRetry,
  })
}
