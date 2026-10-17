'use client'

/**
 * 矛盾求解对话流 React Query 接线（v3-triz-contradiction-copilot W5 · tasks 5.2）。
 *
 * 与 `lib/api/triz-copilot.ts` 成对：纯函数客户端（零 React）负责网络与信封解包，
 * 本模块只做缓存键分层与失效策略（对齐 `use-health-diagnosis.ts` 的既有范式）。
 * 错误态一律透传 `ApiError`（`error.status` 可辨识），**不得**把 4xx/5xx 吞成空数组。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  trizCopilotApi,
  type TrizAnalysisDto,
  type TrizListEnvelope,
  type TrizOverrideInput,
  type TrizSolveInput,
} from './triz-copilot'

// ---------------------------------------------------------------------------
// Query keys（按域分层：all → analyses → list / detail）
// ---------------------------------------------------------------------------

export const trizCopilotKeys = {
  all: ['triz-copilot'] as const,
  analyses: (projectId: number) => ['triz-copilot', 'analyses', projectId] as const,
  list: (projectId: number, page = 1) =>
    ['triz-copilot', 'analyses', projectId, 'list', page] as const,
  detail: (projectId: number, analysisId: number) =>
    ['triz-copilot', 'analyses', projectId, 'detail', analysisId] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** 分析记录列表（`projectId` 缺省时不发请求）。 */
export function useTrizCopilotAnalyses(projectId: number, page = 1) {
  return useQuery<TrizListEnvelope>({
    queryKey: trizCopilotKeys.list(projectId, page),
    queryFn: () => trizCopilotApi.list(projectId, { page }),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

/** 单条分析记录详情与依据。 */
export function useTrizCopilotAnalysis(projectId: number, analysisId: number | null) {
  return useQuery<{ data: TrizAnalysisDto }>({
    queryKey: trizCopilotKeys.detail(projectId, analysisId ?? 0),
    queryFn: () => trizCopilotApi.detail(projectId, analysisId as number),
    enabled: Number.isFinite(projectId) && projectId > 0 && analysisId !== null && analysisId > 0,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** 受理并求解（人工确认关卡：本 mutation 只产草案，零业务表写入）。 */
export function useSolveTrizContradiction(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TrizSolveInput) => trizCopilotApi.solve(projectId, input),
    onSuccess: () => {
      // 新分析记录落库（本能力自有低敏表）→ 列表缓存失效
      queryClient.invalidateQueries({ queryKey: trizCopilotKeys.analyses(projectId) })
    },
  })
}

/** 人工改判参数并重算（只改本分析记录，业务数据零变更）。 */
export function useOverrideTrizContradiction(projectId: number, analysisId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TrizOverrideInput) =>
      trizCopilotApi.override(projectId, analysisId as number, input),
    onSuccess: (result) => {
      if (analysisId !== null) {
        queryClient.setQueryData(trizCopilotKeys.detail(projectId, analysisId), {
          data: result.data,
        })
      }
      queryClient.invalidateQueries({ queryKey: trizCopilotKeys.analyses(projectId) })
    },
  })
}
