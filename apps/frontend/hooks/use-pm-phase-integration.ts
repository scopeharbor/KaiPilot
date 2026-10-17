import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  pmPhaseIntegrationApi,
  pmPhaseIntegrationKeys,
  type ListPmPhaseIntegrationRunsParams,
} from '@/lib/api/triz-pm-phase-integration'
import type {
  PhaseIntegrationRun,
  ReviewPhaseRequest,
  ExplainPhaseRequest,
  PmPhaseHandoffPreviewRequest,
  PhaseHandoffPreview,
} from '@aiproj/types'

export function usePmPhaseIntegrationRuns(
  projectId: number | undefined,
  params?: ListPmPhaseIntegrationRunsParams,
) {
  return useQuery({
    queryKey: pmPhaseIntegrationKeys.list(projectId!, params ?? {}),
    queryFn: () => pmPhaseIntegrationApi.list(projectId!, params),
    enabled: projectId !== undefined && projectId > 0,
  })
}

export function usePmPhaseIntegrationRun(projectId: number | undefined, runId: number | undefined) {
  return useQuery({
    queryKey: pmPhaseIntegrationKeys.detail(projectId!, runId!),
    queryFn: () => pmPhaseIntegrationApi.get(projectId!, runId!),
    enabled: projectId !== undefined && projectId > 0 && runId !== undefined && runId > 0,
  })
}

export function usePmPhaseIntegrationPhases(
  projectId: number | undefined,
  runId: number | undefined,
) {
  return useQuery({
    queryKey: pmPhaseIntegrationKeys.phases(projectId!, runId!),
    queryFn: () => pmPhaseIntegrationApi.listPhases(projectId!, runId!).then((r) => r.data),
    enabled: projectId !== undefined && projectId > 0 && runId !== undefined && runId > 0,
  })
}

export function usePmPhaseIntegrationPhase(
  projectId: number | undefined,
  runId: number | undefined,
  phaseId: string | undefined,
) {
  return useQuery({
    queryKey: pmPhaseIntegrationKeys.phase(projectId!, runId!, phaseId!),
    queryFn: () => pmPhaseIntegrationApi.getPhase(projectId!, runId!, phaseId!),
    enabled:
      projectId !== undefined &&
      projectId > 0 &&
      runId !== undefined &&
      runId > 0 &&
      phaseId !== undefined,
  })
}

export function useCreatePmPhaseIntegrationRun(projectId: number | undefined) {
  const queryClient = useQueryClient()

  return useMutation<PhaseIntegrationRun, Error, { userNotes?: string }>({
    mutationFn: (body) => pmPhaseIntegrationApi.create(projectId!, body),
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: pmPhaseIntegrationKeys.list(projectId),
        })
      }
    },
  })
}

export function useReviewPmPhaseIntegrationPhase(
  projectId: number | undefined,
  runId: number | undefined,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: ReviewPhaseRequest) =>
      pmPhaseIntegrationApi.review(projectId!, runId!, body),
    onSuccess: () => {
      if (projectId && runId) {
        queryClient.invalidateQueries({
          queryKey: pmPhaseIntegrationKeys.phases(projectId, runId),
        })
      }
    },
  })
}

export function useExplainPmPhaseIntegrationPhase(
  projectId: number | undefined,
  runId: number | undefined,
) {
  return useMutation({
    mutationFn: (body: ExplainPhaseRequest) =>
      pmPhaseIntegrationApi.explain(projectId!, runId!, body),
  })
}

export function usePmPhaseIntegrationHandoffPreview(
  projectId: number | undefined,
  runId: number | undefined,
) {
  return useMutation<PhaseHandoffPreview, Error, PmPhaseHandoffPreviewRequest>({
    mutationFn: (body) => pmPhaseIntegrationApi.handoffPreview(projectId!, runId!, body),
  })
}
