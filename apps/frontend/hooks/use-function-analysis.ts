'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  functionAnalysisKeys,
  functionAnalysisApi,
  type ListFunctionAnalysesParams,
  type ListFunctionIssuesParams,
} from '@/lib/api/triz-function-analysis'
import type { CreateFunctionAnalysisRequest, ReviewFunctionIssueRequest } from '@aiproj/types'

export function useFunctionAnalyses(projectId: number, params?: ListFunctionAnalysesParams) {
  return useQuery({
    queryKey: functionAnalysisKeys.list(projectId, params),
    queryFn: () => functionAnalysisApi.list(projectId, params),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useFunctionAnalysis(projectId: number, runId: number) {
  return useQuery({
    queryKey: functionAnalysisKeys.detail(projectId, runId),
    queryFn: () => functionAnalysisApi.get(projectId, runId),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useFunctionAnalysisGraph(projectId: number, runId: number) {
  return useQuery({
    queryKey: functionAnalysisKeys.graph(projectId, runId),
    queryFn: () => functionAnalysisApi.getGraph(projectId, runId),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useFunctionAnalysisIssues(
  projectId: number,
  runId: number,
  params?: ListFunctionIssuesParams,
) {
  return useQuery({
    queryKey: functionAnalysisKeys.issues(projectId, runId, params),
    queryFn: () => functionAnalysisApi.listIssues(projectId, runId, params),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useCreateFunctionAnalysis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: CreateFunctionAnalysisRequest) =>
      functionAnalysisApi.create(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: functionAnalysisKeys.list(projectId),
      })
    },
  })
}

export function useExplainFunctionIssue(projectId: number, runId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (issueKey: string) => functionAnalysisApi.explain(projectId, runId, issueKey),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: functionAnalysisKeys.issues(projectId, runId),
      })
    },
  })
}

export function useReviewFunctionIssue(projectId: number, runId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueKey, body }: { issueKey: string; body: ReviewFunctionIssueRequest }) =>
      functionAnalysisApi.review(projectId, runId, issueKey, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: functionAnalysisKeys.issues(projectId, runId),
      })
    },
  })
}

export function useFunctionWorkbenchPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: (issueKey: string) =>
      functionAnalysisApi.workbenchPreview(projectId, runId, issueKey),
  })
}

export function useFunctionDecisionPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: (issueKey: string) =>
      functionAnalysisApi.decisionPreview(projectId, runId, issueKey),
  })
}

export function useFunctionDraftHandoffPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: ({ issueKey, targetType }: { issueKey: string; targetType: string }) =>
      functionAnalysisApi.handoffPreview(projectId, runId, issueKey, targetType),
  })
}
