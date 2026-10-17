'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRiskSummary,
  getRiskTrend,
  getReviewQueue,
  getMatrixConfig,
  updateMatrixConfig,
  listResponsePlans,
  createResponsePlan,
  updateResponsePlan,
  deleteResponsePlan,
  reviewRisk,
  getRiskHistory,
  evaluateCandidates,
  acceptCandidate,
  rejectCandidate,
  listKnowledgeTemplates,
} from '@/lib/api/risks-v2'

const riskV2Keys = {
  all: ['risks-v2'] as const,
  summary: (projectId: number) => [...riskV2Keys.all, 'summary', projectId] as const,
  trend: (projectId: number, days?: number) =>
    [...riskV2Keys.all, 'trend', projectId, days] as const,
  reviewQueue: (projectId: number) => [...riskV2Keys.all, 'review-queue', projectId] as const,
  matrixConfig: (projectId: number) => [...riskV2Keys.all, 'matrix-config', projectId] as const,
  responsePlans: (projectId: number, riskId: number) =>
    [...riskV2Keys.all, 'response-plans', projectId, riskId] as const,
  riskHistory: (projectId: number, riskId: number) =>
    [...riskV2Keys.all, 'history', projectId, riskId] as const,
  candidates: (projectId: number) => [...riskV2Keys.all, 'candidates', projectId] as const,
  templates: (projectId: number) => [...riskV2Keys.all, 'templates', projectId] as const,
}

/** 风险工作台摘要 */
export function useRiskSummary(projectId: number) {
  return useQuery({
    queryKey: riskV2Keys.summary(projectId),
    queryFn: () => getRiskSummary(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

/** 风险趋势 */
export function useRiskTrend(projectId: number, days?: number) {
  return useQuery({
    queryKey: riskV2Keys.trend(projectId, days),
    queryFn: () => getRiskTrend(projectId, days),
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

/** 复查队列 */
export function useReviewQueue(projectId: number) {
  return useQuery({
    queryKey: riskV2Keys.reviewQueue(projectId),
    queryFn: () => getReviewQueue(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

/** 矩阵配置 */
export function useMatrixConfig(projectId: number) {
  return useQuery({
    queryKey: riskV2Keys.matrixConfig(projectId),
    queryFn: () => getMatrixConfig(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

/** 更新矩阵配置 */
export function useUpdateMatrixConfig(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof updateMatrixConfig>[1]) =>
      updateMatrixConfig(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.matrixConfig(projectId) })
    },
  })
}

/** 应对计划列表 */
export function useResponsePlans(projectId: number, riskId: number | null) {
  return useQuery({
    queryKey: riskV2Keys.responsePlans(projectId, riskId!),
    queryFn: () => listResponsePlans(projectId, riskId!),
    enabled: !!projectId && !!riskId,
  })
}

/** 创建应对计划 */
export function useCreateResponsePlan(projectId: number, riskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof createResponsePlan>[2]) =>
      createResponsePlan(projectId, riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.responsePlans(projectId, riskId) })
    },
  })
}

/** 更新应对计划 */
export function useUpdateResponsePlan(projectId: number, riskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      planId,
      data,
    }: {
      planId: number
      data: Parameters<typeof updateResponsePlan>[3]
    }) => updateResponsePlan(projectId, riskId, planId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.responsePlans(projectId, riskId) })
    },
  })
}

/** 删除应对计划 */
export function useDeleteResponsePlan(projectId: number, riskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (planId: number) => deleteResponsePlan(projectId, riskId, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.responsePlans(projectId, riskId) })
    },
  })
}

/** 提交风险复查 */
export function useReviewRisk(projectId: number, riskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof reviewRisk>[2]) => reviewRisk(projectId, riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.summary(projectId) })
      queryClient.invalidateQueries({ queryKey: riskV2Keys.reviewQueue(projectId) })
    },
  })
}

/** 风险历史 */
export function useRiskHistory(projectId: number, riskId: number | null) {
  return useQuery({
    queryKey: riskV2Keys.riskHistory(projectId, riskId!),
    queryFn: () => getRiskHistory(projectId, riskId!),
    enabled: !!projectId && !!riskId,
  })
}

/** 评估规则候选 */
export function useEvaluateCandidates(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => evaluateCandidates(projectId),
    onSuccess: (result) => {
      queryClient.setQueryData(riskV2Keys.candidates(projectId), result)
    },
  })
}

/** 采纳候选 */
export function useAcceptCandidate(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      candidateId,
      data,
    }: {
      candidateId: number
      data?: Parameters<typeof acceptCandidate>[2]
    }) => acceptCandidate(projectId, candidateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.candidates(projectId) })
      queryClient.invalidateQueries({ queryKey: riskV2Keys.summary(projectId) })
    },
  })
}

/** 拒绝候选 */
export function useRejectCandidate(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (candidateId: number) => rejectCandidate(projectId, candidateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskV2Keys.candidates(projectId) })
    },
  })
}

/** 知识库模板列表 */
export function useKnowledgeTemplates(projectId: number) {
  return useQuery({
    queryKey: riskV2Keys.templates(projectId),
    queryFn: () => listKnowledgeTemplates(projectId),
    enabled: !!projectId,
  })
}
