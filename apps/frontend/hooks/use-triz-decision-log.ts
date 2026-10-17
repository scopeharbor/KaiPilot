'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trizDecisionLogApi, trizDecisionLogKeys } from '@/lib/api/triz-decision-log'
import type {
  TrizDecisionLogCreateRequest,
  TrizDecisionLogSupersedeRequest,
  TrizDecisionSubjectLookupRequest,
  TrizDecisionAiDraftRequest,
} from '@aiproj/types'

/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志 React Hooks。
 *
 * 所有创建/废止操作均需用户确认，AI 仅为辅助草稿生成。
 */

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** 获取决策日志列表（分页）。 */
export function useTrizDecisionLogsList(projectId: number, page = 1, perPage = 20) {
  return useQuery({
    queryKey: trizDecisionLogKeys.list(projectId, page, perPage),
    queryFn: () => trizDecisionLogApi.list(projectId, page, perPage),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

/** 获取决策日志详情。 */
export function useTrizDecisionLogDetail(projectId: number, decisionLogId: number | null) {
  return useQuery({
    queryKey: trizDecisionLogKeys.detail(projectId, decisionLogId!),
    queryFn: () => trizDecisionLogApi.detail(projectId, decisionLogId!),
    enabled:
      Number.isFinite(projectId) &&
      projectId > 0 &&
      Number.isFinite(decisionLogId) &&
      (decisionLogId ?? 0) > 0,
  })
}

/** 主题查询 —— 按 subject ref 查询相关决策日志。 */
export function useTrizDecisionSubjectLookup(
  projectId: number,
  kind: string | null,
  id: string | null,
) {
  return useQuery({
    queryKey: trizDecisionLogKeys.subjectLookup(projectId, kind!, id!),
    queryFn: () => {
      const payload: TrizDecisionSubjectLookupRequest = {
        kind: kind! as TrizDecisionSubjectLookupRequest['kind'],
        id: id!,
      }
      return trizDecisionLogApi.subjectLookup(projectId, payload)
    },
    enabled: Number.isFinite(projectId) && projectId > 0 && !!kind && !!id,
  })
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** 创建决策日志。 */
export function useCreateTrizDecisionLog(projectId: number) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (data: TrizDecisionLogCreateRequest) => trizDecisionLogApi.create(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizDecisionLogKeys.list(projectId) })
      qc.invalidateQueries({ queryKey: trizDecisionLogKeys.all })
    },
  })
}

/** 废止旧决策（追加式修订）。 */
export function useSupersedeTrizDecisionLog(projectId: number) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      decisionLogId,
      data,
    }: {
      decisionLogId: number
      data: TrizDecisionLogSupersedeRequest
    }) => trizDecisionLogApi.supersede(projectId, decisionLogId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizDecisionLogKeys.list(projectId) })
      qc.invalidateQueries({ queryKey: trizDecisionLogKeys.all })
    },
  })
}

/** AI 辅助决策理由草稿生成（建议型，不落库）。 */
export function useTrizDecisionAiDraft(projectId: number) {
  return useMutation({
    mutationFn: (data: TrizDecisionAiDraftRequest) =>
      trizDecisionLogApi.draftReason(projectId, data),
  })
}
