'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  technicalContradictionKeys,
  technicalContradictionApi,
  type ListTechnicalAnalysesParams,
  type ListTechnicalCandidatesParams,
} from '@/lib/api/triz-technical-contradiction'
import type { CreateTechnicalAnalysisRequest, ReviewTechnicalCandidateRequest } from '@aiproj/types'

export function useTechnicalAnalyses(projectId: number, params?: ListTechnicalAnalysesParams) {
  return useQuery({
    queryKey: technicalContradictionKeys.list(projectId, params),
    queryFn: () => technicalContradictionApi.list(projectId, params),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useTechnicalAnalysis(projectId: number, runId: number) {
  return useQuery({
    queryKey: technicalContradictionKeys.detail(projectId, runId),
    queryFn: () => technicalContradictionApi.get(projectId, runId),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useTechnicalCandidates(
  projectId: number,
  runId: number,
  params?: ListTechnicalCandidatesParams,
) {
  return useQuery({
    queryKey: technicalContradictionKeys.candidates(projectId, runId, params),
    queryFn: () => technicalContradictionApi.listCandidates(projectId, runId, params),
    enabled: projectId > 0 && runId > 0,
  })
}

export function useCreateTechnicalAnalysis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: CreateTechnicalAnalysisRequest) =>
      technicalContradictionApi.create(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: technicalContradictionKeys.list(projectId) })
    },
  })
}

export function useExplainTechnicalCandidate(projectId: number, runId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (candidateKey: string) =>
      technicalContradictionApi.explain(projectId, runId, candidateKey),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: technicalContradictionKeys.candidates(projectId, runId),
      })
    },
  })
}

export function useReviewTechnicalCandidate(projectId: number, runId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      candidateKey,
      body,
    }: {
      candidateKey: string
      body: ReviewTechnicalCandidateRequest
    }) => technicalContradictionApi.review(projectId, runId, candidateKey, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: technicalContradictionKeys.candidates(projectId, runId),
      })
    },
  })
}

export function useTechnicalConfirmationPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: (candidateKey: string) =>
      technicalContradictionApi.confirmationPreview(projectId, runId, candidateKey),
  })
}

export function useTechnicalHandoffPreview(projectId: number, runId: number) {
  return useMutation({
    mutationFn: ({ candidateKey, targetType }: { candidateKey: string; targetType: string }) =>
      technicalContradictionApi.handoffPreview(projectId, runId, candidateKey, targetType),
  })
}
