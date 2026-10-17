'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  physicalContradictionKeys,
  physicalContradictionApi,
  type ListPhysicalAnalysesParams,
  type ListPhysicalCandidatesParams,
} from '@/lib/api/triz-physical-contradiction'
import type { CreatePhysicalAnalysisRequest, ReviewPhysicalCandidateRequest } from '@aiproj/types'

export function usePhysicalAnalyses(projectId: number, params?: ListPhysicalAnalysesParams) {
  return useQuery({
    queryKey: physicalContradictionKeys.list(projectId, params),
    queryFn: () => physicalContradictionApi.list(projectId, params),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function usePhysicalAnalysis(projectId: number, runId: number) {
  return useQuery({
    queryKey: physicalContradictionKeys.detail(projectId, runId),
    queryFn: () => physicalContradictionApi.get(projectId, runId),
    enabled: projectId > 0 && runId > 0,
  })
}

export function usePhysicalCandidates(
  projectId: number,
  runId: number,
  params?: ListPhysicalCandidatesParams,
) {
  return useQuery({
    queryKey: physicalContradictionKeys.candidates(projectId, runId, params),
    queryFn: () => physicalContradictionApi.listCandidates(projectId, runId, params),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useCreatePhysicalAnalysis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: CreatePhysicalAnalysisRequest) =>
      physicalContradictionApi.create(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: physicalContradictionKeys.list(projectId) })
    },
  })
}

export function useExplainPhysicalCandidate(projectId: number, runId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (candidateKey: string) =>
      physicalContradictionApi.explain(projectId, runId, candidateKey),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: physicalContradictionKeys.candidates(projectId, runId),
      })
    },
  })
}

export function useReviewPhysicalCandidate(projectId: number, runId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      candidateKey,
      body,
    }: {
      candidateKey: string
      body: ReviewPhysicalCandidateRequest
    }) => physicalContradictionApi.review(projectId, runId, candidateKey, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: physicalContradictionKeys.candidates(projectId, runId),
      })
    },
  })
}

export function useConfirmationPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: (candidateKey: string) =>
      physicalContradictionApi.confirmationPreview(projectId, runId, candidateKey),
  })
}

export function useHandoffPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: ({ candidateKey, targetType }: { candidateKey: string; targetType: string }) =>
      physicalContradictionApi.handoffPreview(projectId, runId, candidateKey, targetType),
  })
}
