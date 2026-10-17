'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  impactAnalysisKeys,
  createImpactAnalysis,
  getImpactAnalysis,
  listImpactAnalyses,
  refreshImpactAnalysis,
  confirmImpactAnalysis,
  confirmStaleImpactAnalysis,
  generateAiExplanation,
} from '@/lib/api/change-requests'

export type {
  ChangeImpactAnalysis,
  ChangeImpactItem,
  ChangeImpactSummary,
} from '@/lib/api/change-requests'

export function useCreateImpactAnalysis(projectId: number, changeRequestId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scope?: Parameters<typeof createImpactAnalysis>[2]) =>
      createImpactAnalysis(projectId, changeRequestId, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: impactAnalysisKeys.lists(projectId, changeRequestId) })
    },
  })
}

export function useImpactAnalysis(analysisId: number, projectId?: number) {
  return useQuery({
    queryKey: impactAnalysisKeys.detail(analysisId),
    queryFn: () => getImpactAnalysis(analysisId, projectId ?? 0),
    enabled: !!analysisId,
  })
}

export function useListImpactAnalyses(projectId: number, changeRequestId: number, page = 1) {
  return useQuery({
    queryKey: impactAnalysisKeys.list(projectId, changeRequestId, page),
    queryFn: () => listImpactAnalyses(projectId, changeRequestId, page),
    enabled: !!changeRequestId,
  })
}

export function useRefreshImpactAnalysis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (analysisId: number) => refreshImpactAnalysis(analysisId, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: impactAnalysisKeys.all }),
  })
}

export function useConfirmImpactAnalysis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ analysisId, reason }: { analysisId: number; reason?: string }) =>
      confirmImpactAnalysis(analysisId, projectId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: impactAnalysisKeys.all }),
  })
}

export function useConfirmStaleImpactAnalysis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ analysisId, reason }: { analysisId: number; reason: string }) =>
      confirmStaleImpactAnalysis(analysisId, projectId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: impactAnalysisKeys.all }),
  })
}

export function useGenerateAiExplanation(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ analysisId, focus }: { analysisId: number; focus?: string }) =>
      generateAiExplanation(analysisId, projectId, focus),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: impactAnalysisKeys.detail(vars.analysisId) }),
  })
}
