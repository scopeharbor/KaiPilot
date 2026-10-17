import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  pmoAiPriorityRecommendationsKeys,
  fetchPmoRecommendationList,
  fetchPmoRecommendationSummary,
  fetchPmoRecommendationDetail,
  refreshPmoRecommendations,
  generatePmoAiRationale,
  updatePmoRecommendationStatus,
} from '@/lib/api/pmo-ai-priority-recommendations'
import type {
  PmoRecommendationListQuery,
  PmoRecommendationSummaryQuery,
  PmoAiRationaleRequest,
  PmoReviewActionRequest,
} from '@aiproj/types'

/** 获取 PMO AI 推荐队列列表。 */
export function usePmoRecommendationList(query?: PmoRecommendationListQuery) {
  return useQuery({
    queryKey: pmoAiPriorityRecommendationsKeys.list(query),
    queryFn: () => fetchPmoRecommendationList(query),
    staleTime: 60_000,
  })
}

/** 获取 PMO AI 推荐摘要。 */
export function usePmoRecommendationSummary(query?: PmoRecommendationSummaryQuery) {
  return useQuery({
    queryKey: pmoAiPriorityRecommendationsKeys.summary(query),
    queryFn: () => fetchPmoRecommendationSummary(query),
    staleTime: 30_000,
  })
}

/** 获取 PMO AI 推荐详情。 */
export function usePmoRecommendationDetail(id: number | undefined) {
  return useQuery({
    queryKey: pmoAiPriorityRecommendationsKeys.detail(id!),
    queryFn: () => fetchPmoRecommendationDetail(id!),
    staleTime: 60_000,
    enabled: !!id,
  })
}

/** 刷新 PMO AI 推荐候选。 */
export function useRefreshPmoRecommendations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: refreshPmoRecommendations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pmoAiPriorityRecommendationsKeys.all })
    },
  })
}

/** 生成/重新生成 AI 理由。 */
export function useGeneratePmoAiRationale(id: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: PmoAiRationaleRequest) => generatePmoAiRationale(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pmoAiPriorityRecommendationsKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: pmoAiPriorityRecommendationsKeys.all })
    },
  })
}

/** 审查动作（accept / dismiss / snooze / convert）。 */
export function useUpdatePmoRecommendationStatus(id: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: PmoReviewActionRequest) => updatePmoRecommendationStatus(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pmoAiPriorityRecommendationsKeys.all })
    },
  })
}
