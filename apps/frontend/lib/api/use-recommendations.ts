'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listRecommendations,
  getRecommendationSummary,
  getRecommendationDetail,
  refreshRecommendations,
  updateRecommendationStatus,
  generateAiExplanation,
  approveAiExplanation,
  rejectAiExplanation,
} from './recommendations'
import type { RecommendationSource, RecommendationStatus } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const recommendationKeys = {
  all: ['recommendations'] as const,
  list: (projectId: number, filters?: Record<string, unknown>) =>
    ['recommendations', 'list', projectId, filters] as const,
  summary: (projectId: number) => ['recommendations', 'summary', projectId] as const,
  detail: (projectId: number, recId: number) =>
    ['recommendations', 'detail', projectId, recId] as const,
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** 获取推荐列表 */
export function useRecommendationsList(projectId: number, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: recommendationKeys.list(projectId, filters),
    queryFn: () => listRecommendations(projectId, filters),
    enabled: !!projectId,
  })
}

/** 获取推荐摘要 */
export function useRecommendationSummary(projectId: number) {
  return useQuery({
    queryKey: recommendationKeys.summary(projectId),
    queryFn: () => getRecommendationSummary(projectId),
    enabled: !!projectId,
  })
}

/** 获取推荐详情 */
export function useRecommendationDetail(projectId: number, recId: number) {
  return useQuery({
    queryKey: recommendationKeys.detail(projectId, recId),
    queryFn: () => getRecommendationDetail(projectId, recId),
    enabled: !!projectId && !!recId,
  })
}

/** 刷新推荐 */
export function useRefreshRecommendations(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sources?: RecommendationSource[]) => refreshRecommendations(projectId, sources),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recommendationKeys.all })
    },
  })
}

/** 更新推荐状态 */
export function useUpdateRecommendationStatus(projectId: number) {
  const qc = useQueryClient()
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
      qc.invalidateQueries({ queryKey: recommendationKeys.all })
    },
  })
}

/** 生成 AI 解释 */
export function useGenerateAiExplanation(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (recId: number) => generateAiExplanation(projectId, recId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recommendationKeys.all })
    },
  })
}

/** 确认 AI 解释 */
export function useApproveAiExplanation(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ recId, notes }: { recId: number; notes?: string }) =>
      approveAiExplanation(projectId, recId, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recommendationKeys.all })
    },
  })
}

/** 拒绝 AI 解释 */
export function useRejectAiExplanation(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ recId, reason }: { recId: number; reason: string }) =>
      rejectAiExplanation(projectId, recId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recommendationKeys.all })
    },
  })
}
