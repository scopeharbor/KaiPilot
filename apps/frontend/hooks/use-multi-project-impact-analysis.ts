import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query'
import {
  multiProjectImpactKeys,
  planMultiProjectImpactAnalysis,
  runMultiProjectImpactAnalysis,
  listMultiProjectImpactSnapshots,
  readMultiProjectImpactSnapshot,
  refreshMultiProjectImpactSnapshot,
  compareWhatIfMultiProjectImpact,
  exportMultiProjectImpactAnalysis,
  buildMultiProjectImpactFollowUpDraft,
  requestMultiProjectImpactAiExplanation,
  drillDownMultiProjectImpact,
} from '@/lib/api/multi-project-impact-analysis'
import type {
  MultiProjectImpactScope,
  MultiProjectImpactPlan,
  MultiProjectImpactSnapshot,
  MultiProjectImpactListQuery,
  MultiProjectImpactListResponse,
  MultiProjectImpactWhatIfRequest,
  MultiProjectImpactWhatIfResponse,
  MultiProjectImpactFollowUpRequest,
  MultiProjectImpactFollowUpDraft,
  MultiProjectImpactAiExplanation,
  MultiProjectImpactAffectedEndpoint,
  MultiProjectImpactPropagationPath,
} from '@aiproj/types'

// ─── List Snapshot Hook ────────────────────────────────────────────

export function useMultiProjectImpactSnapshots(
  organizationId: number,
  query?: MultiProjectImpactListQuery,
): UseQueryResult<MultiProjectImpactListResponse> {
  return useQuery({
    queryKey: multiProjectImpactKeys.list(organizationId, query),
    queryFn: () => listMultiProjectImpactSnapshots(organizationId, query),
    enabled: Boolean(organizationId),
  })
}

// ─── Detail Snapshot Hook ──────────────────────────────────────────

export function useMultiProjectImpactSnapshot(
  organizationId: number,
  snapshotId: number | null,
): UseQueryResult<MultiProjectImpactSnapshot> {
  return useQuery({
    queryKey: multiProjectImpactKeys.detail(organizationId, snapshotId!),
    queryFn: () => readMultiProjectImpactSnapshot(organizationId, snapshotId!).then((r) => r.data),
    enabled: Boolean(organizationId && snapshotId),
  })
}

// ─── Plan Mutation ─────────────────────────────────────────────────

export function usePlanMultiProjectImpactAnalysis(
  organizationId: number,
): UseMutationResult<MultiProjectImpactPlan, Error, MultiProjectImpactScope> {
  return useMutation({
    mutationFn: (scope: MultiProjectImpactScope) =>
      planMultiProjectImpactAnalysis(organizationId, scope).then((r) => r.data),
  })
}

// ─── Run Mutation ──────────────────────────────────────────────────

export function useRunMultiProjectImpactAnalysis(
  organizationId: number,
): UseMutationResult<MultiProjectImpactSnapshot, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runToken: string) =>
      runMultiProjectImpactAnalysis(organizationId, { runToken }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: multiProjectImpactKeys.all(organizationId),
      })
    },
  })
}

// ─── Refresh Mutation ──────────────────────────────────────────────

export function useRefreshMultiProjectImpactSnapshot(
  organizationId: number,
): UseMutationResult<MultiProjectImpactSnapshot, Error, number> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: number) =>
      refreshMultiProjectImpactSnapshot(organizationId, { snapshotId }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: multiProjectImpactKeys.all(organizationId),
      })
    },
  })
}

// ─── What-if Mutation ──────────────────────────────────────────────

export function useWhatIfMultiProjectImpact(
  organizationId: number,
): UseMutationResult<MultiProjectImpactWhatIfResponse, Error, MultiProjectImpactWhatIfRequest> {
  return useMutation({
    mutationFn: (params) => compareWhatIfMultiProjectImpact(organizationId, params),
  })
}

// ─── Export Mutation ───────────────────────────────────────────────

export function useExportMultiProjectImpact(
  organizationId: number,
): UseMutationResult<
  { snapshotId: number; snapshotHash: string; format: string; content: string },
  Error,
  { snapshotId: number; format: 'json' | 'csv' }
> {
  return useMutation({
    mutationFn: (params) =>
      exportMultiProjectImpactAnalysis(organizationId, params).then((r) => r.data),
  })
}

// ─── Follow-up Draft Mutation ──────────────────────────────────────

export function useFollowUpDraftMultiProjectImpact(
  organizationId: number,
): UseMutationResult<MultiProjectImpactFollowUpDraft, Error, MultiProjectImpactFollowUpRequest> {
  return useMutation({
    mutationFn: (params) =>
      buildMultiProjectImpactFollowUpDraft(organizationId, params).then((r) => r.data),
  })
}

// ─── AI Explanation Mutation ───────────────────────────────────────

export function useAiExplanationMultiProjectImpact(
  organizationId: number,
): UseMutationResult<
  MultiProjectImpactAiExplanation,
  Error,
  { snapshotId: number; focus?: string | null }
> {
  return useMutation({
    mutationFn: (params) =>
      requestMultiProjectImpactAiExplanation(organizationId, params).then((r) => r.data),
  })
}

// ─── Drill-down Hook ───────────────────────────────────────────────

export function useDrillDownMultiProjectImpact(organizationId: number): UseMutationResult<
  MultiProjectImpactAffectedEndpoint & {
    fullPath: MultiProjectImpactPropagationPath
    authorizationVerified: boolean
  },
  Error,
  { snapshotId: number; endpointHash: string }
> {
  return useMutation({
    mutationFn: (params) => drillDownMultiProjectImpact(organizationId, params).then((r) => r.data),
  })
}
