import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  evolutionTrendApi,
  evolutionTrendKeys,
  type ListEvolutionTrendAnalysesParams,
  type ListEvolutionTrendScoresParams,
  type ListEvolutionTrendRisksParams,
  type EvolutionTrendHistoryParams,
} from '@/lib/api/triz-evolution-trend-analysis'
import type {
  CreateEvolutionTrendAnalysisRequest,
  ReviewEvolutionTrendRiskRequest,
} from '@aiproj/types'

export function useEvolutionTrendAnalyses(
  projectId: number,
  params?: ListEvolutionTrendAnalysesParams,
) {
  return useQuery({
    queryKey: evolutionTrendKeys.list(projectId, params),
    queryFn: () => evolutionTrendApi.list(projectId, params!),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useEvolutionTrendRun(projectId: number, runId: number) {
  return useQuery({
    queryKey: evolutionTrendKeys.detail(projectId, runId),
    queryFn: () => evolutionTrendApi.get(projectId, runId),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useEvolutionTrendScores(
  projectId: number,
  runId: number,
  params?: ListEvolutionTrendScoresParams,
) {
  return useQuery({
    queryKey: evolutionTrendKeys.trends(projectId, runId, params),
    queryFn: () => evolutionTrendApi.listTrends(projectId, runId, params!),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useEvolutionTrendRisks(
  projectId: number,
  runId: number,
  params?: ListEvolutionTrendRisksParams,
) {
  return useQuery({
    queryKey: evolutionTrendKeys.risks(projectId, runId, params),
    queryFn: () => evolutionTrendApi.listRisks(projectId, runId, params!),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useEvolutionTrendHistory(
  projectId: number,
  runId: number,
  params?: EvolutionTrendHistoryParams,
) {
  return useQuery({
    queryKey: evolutionTrendKeys.history(projectId, runId, params),
    queryFn: () => evolutionTrendApi.history(projectId, runId, params),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useCreateEvolutionTrendAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      body,
    }: {
      projectId: number
      body?: CreateEvolutionTrendAnalysisRequest
    }) => evolutionTrendApi.create(projectId, body),
    onSuccess: (_data, { projectId }) => {
      qc.invalidateQueries({ queryKey: evolutionTrendKeys.list(projectId) })
    },
  })
}

export function useReviewEvolutionTrendRisk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      riskId,
      body,
    }: {
      projectId: number
      runId: number
      riskId: number
      body: ReviewEvolutionTrendRiskRequest
    }) => evolutionTrendApi.review(projectId, runId, riskId, body),
    onSuccess: (_data, { projectId, runId }) => {
      qc.invalidateQueries({ queryKey: evolutionTrendKeys.risks(projectId, runId) })
    },
  })
}

export function useExplainEvolutionTrendRisk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      riskId,
    }: {
      projectId: number
      runId: number
      riskId: number
    }) => evolutionTrendApi.explain(projectId, runId, riskId),
    onSuccess: (_data, { projectId, runId }) => {
      qc.invalidateQueries({ queryKey: evolutionTrendKeys.risks(projectId, runId) })
    },
  })
}

export function useEvolutionWorkbenchPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      riskId,
    }: {
      projectId: number
      runId: number
      riskId: number
    }) => evolutionTrendApi.workbenchPreview(projectId, runId, riskId),
  })
}

export function useEvolutionDecisionPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      riskId,
    }: {
      projectId: number
      runId: number
      riskId: number
    }) => evolutionTrendApi.decisionPreview(projectId, runId, riskId),
  })
}

export function useEvolutionDraftPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      riskId,
    }: {
      projectId: number
      runId: number
      riskId: number
    }) => evolutionTrendApi.draftPreview(projectId, runId, riskId),
  })
}

export function useEvolutionRiskPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      riskId,
    }: {
      projectId: number
      runId: number
      riskId: number
    }) => evolutionTrendApi.riskPreview(projectId, runId, riskId),
  })
}
