import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  pmoTrafficLightKeys,
  fetchTrafficLightList,
  fetchTrafficLightCounts,
  fetchTrafficLightDetail,
  upsertTrafficLightReview,
} from '@/lib/api/pmo-traffic-light'
import type {
  PortfolioTrafficLightListQuery,
  PortfolioTrafficLightReviewRequest,
} from '@aiproj/types'

/** 获取 PMO 组合交通灯列表 */
export function useTrafficLightList(query?: PortfolioTrafficLightListQuery) {
  return useQuery({
    queryKey: pmoTrafficLightKeys.list(query),
    queryFn: () => fetchTrafficLightList(query),
    staleTime: 60_000,
  })
}

/** 获取交通灯计数摘要 */
export function useTrafficLightCounts() {
  return useQuery({
    queryKey: pmoTrafficLightKeys.counts(),
    queryFn: fetchTrafficLightCounts,
    staleTime: 60_000,
  })
}

/** 获取单个项目交通灯详情 */
export function useTrafficLightDetail(projectId: number | undefined) {
  return useQuery({
    queryKey: pmoTrafficLightKeys.detail(projectId!),
    queryFn: () => fetchTrafficLightDetail(projectId!),
    staleTime: 60_000,
    enabled: !!projectId,
  })
}

/** 创建/更新复核标记（乐观更新安全——仅在成功时 invalidate）。 */
export function useUpsertTrafficLightReview(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: PortfolioTrafficLightReviewRequest) =>
      upsertTrafficLightReview(projectId, body),
    onSuccess: () => {
      // 列表和详情都需要刷新
      queryClient.invalidateQueries({ queryKey: pmoTrafficLightKeys.all })
    },
  })
}
