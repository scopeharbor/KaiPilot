'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trizCompilerAnalysisApi, trizCompilerAnalysisKeys } from '@/lib/api/triz-compiler-analysis'
import type { TrizDraftHandoffRequest } from '@aiproj/types'

/**
 * v2-triz-compiler-analysis-layer —— TRIZ Compiler 分析层 React Hooks。
 */

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** 获取 TRIZ Compiler 分析 artifact 列表。 */
export function useTrizAnalysisList(runId: number) {
  return useQuery({
    queryKey: trizCompilerAnalysisKeys.list(runId),
    queryFn: () => trizCompilerAnalysisApi.list(runId),
    enabled: Number.isFinite(runId) && runId > 0,
  })
}

/** 获取指定 artifact 详情。 */
export function useTrizAnalysisDetail(runId: number, artifactId: string | null) {
  return useQuery({
    queryKey: trizCompilerAnalysisKeys.detail(runId, artifactId!),
    queryFn: () => trizCompilerAnalysisApi.detail(runId, artifactId!),
    enabled: Number.isFinite(runId) && runId > 0 && !!artifactId,
  })
}

/** 获取 Dashboard TRIZ Compiler 分析摘要。 */
export function useTrizCompilerDashboardSummary(projectId: number) {
  return useQuery({
    queryKey: trizCompilerAnalysisKeys.dashboardSummary(projectId),
    queryFn: () => trizCompilerAnalysisApi.getDashboardSummary(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** 提交 Resolution Path handoff —— 转为 Draft Layer 草稿候选。 */
export function useTrizDraftHandoff(runId: number, artifactId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (data: TrizDraftHandoffRequest) =>
      trizCompilerAnalysisApi.handoff(runId, artifactId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizCompilerAnalysisKeys.list(runId) })
      qc.invalidateQueries({
        queryKey: trizCompilerAnalysisKeys.detail(runId, artifactId),
      })
    },
  })
}
