import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  resourceAnalyzerApi,
  resourceAnalyzerKeys,
  type ListResourceAnalysesParams,
  type ListResourceSnapshotsParams,
  type ListResourceOpportunitiesParams,
} from '@/lib/api/triz-resource-analyzer'
import type { CreateResourceAnalysisRequest, ReviewResourceOpportunityRequest } from '@aiproj/types'

export function useResourceAnalyses(projectId: number, params?: ListResourceAnalysesParams) {
  return useQuery({
    queryKey: resourceAnalyzerKeys.list(projectId, params),
    queryFn: () => resourceAnalyzerApi.list(projectId, params!),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useResourceAnalysisRun(projectId: number, runId: number) {
  return useQuery({
    queryKey: resourceAnalyzerKeys.detail(projectId, runId),
    queryFn: () => resourceAnalyzerApi.get(projectId, runId),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useResourceSnapshots(
  projectId: number,
  runId: number,
  params?: ListResourceSnapshotsParams,
) {
  return useQuery({
    queryKey: resourceAnalyzerKeys.resources(projectId, runId, params),
    queryFn: () => resourceAnalyzerApi.listResources(projectId, runId, params!),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useResourceOpportunities(
  projectId: number,
  runId: number,
  params?: ListResourceOpportunitiesParams,
) {
  return useQuery({
    queryKey: resourceAnalyzerKeys.opportunities(projectId, runId, params),
    queryFn: () => resourceAnalyzerApi.listOpportunities(projectId, runId, params!),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useCreateResourceAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      body,
    }: {
      projectId: number
      body?: CreateResourceAnalysisRequest
    }) => resourceAnalyzerApi.create(projectId, body),
    onSuccess: (_data, { projectId }) => {
      qc.invalidateQueries({ queryKey: resourceAnalyzerKeys.list(projectId) })
    },
  })
}

export function useReviewResourceOpportunity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      opportunityId,
      body,
    }: {
      projectId: number
      runId: number
      opportunityId: number
      body: ReviewResourceOpportunityRequest
    }) => resourceAnalyzerApi.review(projectId, runId, opportunityId, body),
    onSuccess: (_data, { projectId, runId }) => {
      qc.invalidateQueries({
        queryKey: resourceAnalyzerKeys.opportunities(projectId, runId),
      })
    },
  })
}

export function useExplainResourceOpportunity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      opportunityId,
    }: {
      projectId: number
      runId: number
      opportunityId: number
    }) => resourceAnalyzerApi.explain(projectId, runId, opportunityId),
    onSuccess: (_data, { projectId, runId }) => {
      qc.invalidateQueries({
        queryKey: resourceAnalyzerKeys.opportunities(projectId, runId),
      })
    },
  })
}

export function useWorkbenchPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      opportunityId,
    }: {
      projectId: number
      runId: number
      opportunityId: number
    }) => resourceAnalyzerApi.workbenchPreview(projectId, runId, opportunityId),
  })
}

export function useDecisionPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      opportunityId,
    }: {
      projectId: number
      runId: number
      opportunityId: number
    }) => resourceAnalyzerApi.decisionPreview(projectId, runId, opportunityId),
  })
}

export function useDraftPreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      opportunityId,
    }: {
      projectId: number
      runId: number
      opportunityId: number
    }) => resourceAnalyzerApi.draftPreview(projectId, runId, opportunityId),
  })
}

export function useResourcePreview() {
  return useMutation({
    mutationFn: ({
      projectId,
      runId,
      opportunityId,
    }: {
      projectId: number
      runId: number
      opportunityId: number
    }) => resourceAnalyzerApi.resourcePreview(projectId, runId, opportunityId),
  })
}
