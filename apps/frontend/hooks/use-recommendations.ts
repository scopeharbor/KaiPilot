'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRecommendations,
  getRecommendationDetail,
  getRecommendationSummary,
  refreshRecommendations,
  updateRecommendationStatus,
  generateAiExplanation,
  approveAiExplanation,
  rejectAiExplanation,
  convertRecommendation,
  type ListRecommendationsQuery,
  type RecommendationStatus,
  type RecommendationSource,
} from '@/lib/api/recommendations'

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const recommendationKeys = {
  all: ['recommendations'] as const,
  lists: () => [...recommendationKeys.all, 'list'] as const,
  list: (projectId: number, filters: ListRecommendationsQuery) =>
    [...recommendationKeys.lists(), projectId, filters] as const,
  details: () => [...recommendationKeys.all, 'detail'] as const,
  detail: (projectId: number, recId: number) =>
    [...recommendationKeys.details(), projectId, recId] as const,
  summary: (projectId: number) => [...recommendationKeys.all, 'summary', projectId] as const,
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** 推荐列表 */
export function useRecommendations(projectId: number, filters: ListRecommendationsQuery = {}) {
  return useQuery({
    queryKey: recommendationKeys.list(projectId, filters),
    queryFn: () => listRecommendations(projectId, filters),
    enabled: projectId > 0,
  })
}

/** 推荐详情 */
export function useRecommendationDetail(projectId: number, recId: number | null) {
  return useQuery({
    queryKey: recommendationKeys.detail(projectId, recId!),
    queryFn: () => getRecommendationDetail(projectId, recId!),
    enabled: projectId > 0 && recId !== null && recId > 0,
  })
}

/** Dashboard 推荐摘要 */
export function useRecommendationSummary(projectId: number) {
  return useQuery({
    queryKey: recommendationKeys.summary(projectId),
    queryFn: () => getRecommendationSummary(projectId),
    enabled: projectId > 0,
  })
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** 刷新推荐 */
export function useRefreshRecommendations(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sources?: RecommendationSource[]) => refreshRecommendations(projectId, sources),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: recommendationKeys.summary(projectId) })
    },
  })
}

/** 更新推荐状态 */
export function useUpdateRecommendationStatus(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      recId,
      status,
      reason,
    }: {
      recId: number
      status: RecommendationStatus
      reason?: string
    }) => updateRecommendationStatus(projectId, recId, status, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: recommendationKeys.details() })
      queryClient.invalidateQueries({ queryKey: recommendationKeys.summary(projectId) })
    },
  })
}

/** 生成 AI 解释 */
export function useGenerateAiExplanation(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ recId, idempotencyKey }: { recId: number; idempotencyKey?: string }) =>
      generateAiExplanation(projectId, recId, idempotencyKey),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: recommendationKeys.detail(projectId, variables.recId),
      })
    },
  })
}

/** 批准 AI 解释 */
export function useApproveAiExplanation(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ recId, notes }: { recId: number; notes?: string }) =>
      approveAiExplanation(projectId, recId, notes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: recommendationKeys.detail(projectId, variables.recId),
      })
    },
  })
}

/** 驳回 AI 解释 */
export function useRejectAiExplanation(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ recId, reason }: { recId: number; reason: string }) =>
      rejectAiExplanation(projectId, recId, reason),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: recommendationKeys.detail(projectId, variables.recId),
      })
    },
  })
}

/** 转换推荐 */
export function useConvertRecommendation(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      recId,
      convertTo,
      params,
    }: {
      recId: number
      convertTo: string
      params?: Record<string, unknown>
    }) => convertRecommendation(projectId, recId, convertTo, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recommendationKeys.lists() })
      queryClient.invalidateQueries({ queryKey: recommendationKeys.summary(projectId) })
    },
  })
}
