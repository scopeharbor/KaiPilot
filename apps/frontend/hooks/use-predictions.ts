'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createPrediction,
  listPredictions,
  getLatestPrediction,
  getPrediction,
  confirmPrediction,
  dismissPrediction,
  generateAiExplanation,
  approveAiExplanation,
  rejectAiExplanation,
  getDashboardPredictionSummary,
  type ListPredictionsQuery,
  type ConfirmPredictionRequest,
  type DismissPredictionRequest,
  type GenerateAiExplanationRequest,
  type ApproveAiExplanationRequest,
  type RejectAiExplanationRequest,
  type PredictionWindow,
} from '@/lib/api/predictions'

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const predictionKeys = {
  all: ['predictions'] as const,
  lists: () => [...predictionKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...predictionKeys.lists(), filters] as const,
  details: () => [...predictionKeys.all, 'detail'] as const,
  detail: (id: number) => [...predictionKeys.details(), id] as const,
  latest: (projectId: number) => [...predictionKeys.all, 'latest', projectId] as const,
  dashboard: (projectId: number) => [...predictionKeys.all, 'dashboard', projectId] as const,
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** 预测历史列表。 */
export function usePredictionList(projectId: number, query?: ListPredictionsQuery) {
  return useQuery({
    queryKey: predictionKeys.list({ projectId, ...query }),
    queryFn: () => listPredictions(projectId, query),
    enabled: projectId > 0,
  })
}

/** 最新预测快照。 */
export function useLatestPrediction(projectId: number) {
  return useQuery({
    queryKey: predictionKeys.latest(projectId),
    queryFn: () => getLatestPrediction(projectId),
    enabled: projectId > 0,
  })
}

/** 指定预测详情。 */
export function usePredictionDetail(projectId: number, id: number | null) {
  return useQuery({
    queryKey: predictionKeys.detail(id!),
    queryFn: () => getPrediction(projectId, id!),
    enabled: projectId > 0 && id !== null && id > 0,
  })
}

/** Dashboard 预测摘要。 */
export function useDashboardPredictionSummary(projectId: number) {
  return useQuery({
    queryKey: predictionKeys.dashboard(projectId),
    queryFn: () => getDashboardPredictionSummary(projectId),
    enabled: projectId > 0,
  })
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** 创建新预测。 */
export function useCreatePrediction(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { window: PredictionWindow }) => createPrediction(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: predictionKeys.lists() })
      queryClient.invalidateQueries({ queryKey: predictionKeys.latest(projectId) })
      queryClient.invalidateQueries({ queryKey: predictionKeys.dashboard(projectId) })
    },
  })
}

/** 确认预测。 */
export function useConfirmPrediction(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: ConfirmPredictionRequest }) =>
      confirmPrediction(projectId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: predictionKeys.details() })
      queryClient.invalidateQueries({ queryKey: predictionKeys.lists() })
      queryClient.invalidateQueries({ queryKey: predictionKeys.dashboard(projectId) })
    },
  })
}

/** 忽略预测。 */
export function useDismissPrediction(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: DismissPredictionRequest }) =>
      dismissPrediction(projectId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: predictionKeys.details() })
      queryClient.invalidateQueries({ queryKey: predictionKeys.lists() })
      queryClient.invalidateQueries({ queryKey: predictionKeys.dashboard(projectId) })
    },
  })
}

/** 生成 AI 解释。 */
export function useGenerateAiExplanation(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: GenerateAiExplanationRequest }) =>
      generateAiExplanation(projectId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: predictionKeys.details() })
    },
  })
}

/** 批准 AI 解释。 */
export function useApproveAiExplanation(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: ApproveAiExplanationRequest }) =>
      approveAiExplanation(projectId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: predictionKeys.details() })
    },
  })
}

/** 驳回 AI 解释。 */
export function useRejectAiExplanation(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: RejectAiExplanationRequest }) =>
      rejectAiExplanation(projectId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: predictionKeys.details() })
    },
  })
}
