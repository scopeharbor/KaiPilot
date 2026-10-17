// OKR Dashboard TanStack Query hook（v3-okr-dashboard §5.1）。
//
// 仅 GET 查询。无当前组织 ID 时 `enabled: false`，不发无效请求。
// 通过 queryRetry 保证 401/403 不重试；其它错误默认重试一次。

import { useQuery } from '@tanstack/react-query'
import { fetchOkrDashboardSummary, okrDashboardKeys } from '@/lib/api/okr-dashboard'
import { queryRetry } from '@/lib/api-client'
import type { OkrDashboardQuery } from '@aiproj/types'

export interface UseOkrDashboardOptions {
  /** 组织 ID，null 表示未选组织，hook 返回 disabled query。 */
  organizationId: number | null
  /** 白名单 query 参数。 */
  query?: OkrDashboardQuery
  /** 覆盖 staleTime，默认 60s（Dashboard 数据以只读聚合为主）。 */
  staleTime?: number
  /** 显式 enable/disable，缺省时按 organizationId 是否非空推导。 */
  enabled?: boolean
}

/**
 * 拉取 OKR Dashboard 摘要（只读）。
 *
 * 页面层可根据 `isLoading` / `isError` / `error.status` 派生
 * 空态 / forbidden / stale / unavailable UI。
 */
export function useOkrDashboardSummary(options: UseOkrDashboardOptions) {
  const { organizationId, query, staleTime = 60_000, enabled } = options
  const finalEnabled = typeof enabled === 'boolean' ? enabled : organizationId !== null

  return useQuery({
    queryKey: okrDashboardKeys.summary(organizationId, query),
    queryFn: () => fetchOkrDashboardSummary(organizationId as number, query),
    enabled: finalEnabled,
    staleTime,
    retry: queryRetry,
  })
}
