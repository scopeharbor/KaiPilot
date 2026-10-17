// OKR 层级管理 TanStack Query hooks（v3-okr-hierarchy-management §6.1）。
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  okrCyclesApi,
  okrObjectivesApi,
  okrTreeApi,
  okrKeyResultsApi,
  okrProgressApi,
  okrAlignmentsApi,
  okrEvidenceApi,
  okrAiDraftApi,
} from '@/lib/api/okr'
import type {
  OkrCycleCreateRequest,
  OkrCycleUpdateRequest,
  OkrObjectiveCreateRequest,
  OkrObjectiveUpdateRequest,
  OkrKeyResultCreateRequest,
  OkrKeyResultUpdateRequest,
  OkrProgressUpdateRequest,
  OkrAlignmentCreateRequest,
  OkrEvidenceLinkCreateRequest,
  OkrAiDraftRequest,
  OkrAiDraftConfirmationRequest,
  OkrCycleListQuery,
  OkrObjectiveListQuery,
  OkrTreeQuery,
  OkrKeyResultListQuery,
  OkrEvidenceListQuery,
} from '@aiproj/types'

// ── Query Keys ──────────────────────────────────────────────────────────────

export const okrKeys = {
  all: (organizationId: number) => ['okr', organizationId] as const,
  cycles: (organizationId: number) => [...okrKeys.all(organizationId), 'cycles'] as const,
  cycleList: (organizationId: number, query: OkrCycleListQuery = {}) =>
    [...okrKeys.cycles(organizationId), query] as const,
  cycle: (organizationId: number, cycleId: number) =>
    [...okrKeys.cycles(organizationId), cycleId] as const,
  objectives: (organizationId: number) => [...okrKeys.all(organizationId), 'objectives'] as const,
  objectiveList: (organizationId: number, query: OkrObjectiveListQuery = {}) =>
    [...okrKeys.objectives(organizationId), query] as const,
  objective: (organizationId: number, objectiveId: number) =>
    [...okrKeys.objectives(organizationId), objectiveId] as const,
  tree: (organizationId: number, query: OkrTreeQuery = {}) =>
    [...okrKeys.all(organizationId), 'tree', query] as const,
  keyResults: (organizationId: number) => [...okrKeys.all(organizationId), 'keyResults'] as const,
  keyResultList: (organizationId: number, query: OkrKeyResultListQuery = {}) =>
    [...okrKeys.keyResults(organizationId), query] as const,
  keyResult: (organizationId: number, krId: number) =>
    [...okrKeys.keyResults(organizationId), krId] as const,
  progressHistory: (organizationId: number, krId: number) =>
    [...okrKeys.keyResult(organizationId, krId), 'progressHistory'] as const,
  alignments: (organizationId: number, objectiveId: number) =>
    [...okrKeys.objective(organizationId, objectiveId), 'alignments'] as const,
  evidence: (organizationId: number) => [...okrKeys.all(organizationId), 'evidence'] as const,
  evidenceList: (organizationId: number, query: OkrEvidenceListQuery = {}) =>
    [...okrKeys.evidence(organizationId), query] as const,
}

// ── Cycles ─────────────────────────────────────────────────────────────────

export function useOkrCycles(organizationId: number, query: OkrCycleListQuery = {}) {
  return useQuery({
    queryKey: okrKeys.cycleList(organizationId, query),
    queryFn: () => okrCyclesApi.list(organizationId, query),
    enabled: organizationId > 0,
  })
}

export function useOkrCycle(organizationId: number, cycleId: number) {
  return useQuery({
    queryKey: okrKeys.cycle(organizationId, cycleId),
    queryFn: () => okrCyclesApi.get(organizationId, cycleId),
    enabled: organizationId > 0 && cycleId > 0,
  })
}

export function useCreateOkrCycle(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrCycleCreateRequest) => okrCyclesApi.create(organizationId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrKeys.cycles(organizationId) }),
  })
}

export function useUpdateOkrCycle(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cycleId, input }: { cycleId: number; input: OkrCycleUpdateRequest }) =>
      okrCyclesApi.update(organizationId, cycleId, input),
    onSuccess: (_, { cycleId }) => {
      qc.invalidateQueries({ queryKey: okrKeys.cycles(organizationId) })
      qc.invalidateQueries({ queryKey: okrKeys.cycle(organizationId, cycleId) })
    },
  })
}

export function useArchiveOkrCycle(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cycleId: number) => okrCyclesApi.archive(organizationId, cycleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrKeys.cycles(organizationId) }),
  })
}

// ── Objectives ────────────────────────────────────────────────────────────

export function useOkrObjectives(organizationId: number, query: OkrObjectiveListQuery = {}) {
  return useQuery({
    queryKey: okrKeys.objectiveList(organizationId, query),
    queryFn: () => okrObjectivesApi.list(organizationId, query),
    enabled: organizationId > 0,
  })
}

export function useOkrObjective(organizationId: number, objectiveId: number) {
  return useQuery({
    queryKey: okrKeys.objective(organizationId, objectiveId),
    queryFn: () => okrObjectivesApi.get(organizationId, objectiveId),
    enabled: organizationId > 0 && objectiveId > 0,
  })
}

export function useCreateOkrObjective(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrObjectiveCreateRequest) =>
      okrObjectivesApi.create(organizationId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: okrKeys.objectives(organizationId) })
      qc.invalidateQueries({ queryKey: okrKeys.all(organizationId) })
    },
  })
}

export function useUpdateOkrObjective(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      objectiveId,
      input,
    }: {
      objectiveId: number
      input: OkrObjectiveUpdateRequest
    }) => okrObjectivesApi.update(organizationId, objectiveId, input),
    onSuccess: (_, { objectiveId }) => {
      qc.invalidateQueries({ queryKey: okrKeys.objectives(organizationId) })
      qc.invalidateQueries({ queryKey: okrKeys.objective(organizationId, objectiveId) })
    },
  })
}

// ── Tree ────────────────────────────────────────────────────────────────

export function useOkrTree(organizationId: number, query: OkrTreeQuery = {}) {
  return useQuery({
    queryKey: okrKeys.tree(organizationId, query),
    queryFn: () => okrTreeApi.get(organizationId, query),
    enabled: organizationId > 0,
  })
}

// ── Key Results ────────────────────────────────────────────────────────────

export function useOkrKeyResults(organizationId: number, query: OkrKeyResultListQuery = {}) {
  return useQuery({
    queryKey: okrKeys.keyResultList(organizationId, query),
    queryFn: () => okrKeyResultsApi.list(organizationId, query),
    enabled: organizationId > 0,
  })
}

export function useCreateOkrKeyResult(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrKeyResultCreateRequest) =>
      okrKeyResultsApi.create(organizationId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: okrKeys.keyResults(organizationId) })
      qc.invalidateQueries({ queryKey: okrKeys.all(organizationId) })
    },
  })
}

export function useUpdateOkrKeyResult(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ krId, input }: { krId: number; input: OkrKeyResultUpdateRequest }) =>
      okrKeyResultsApi.update(organizationId, krId, input),
    onSuccess: (_, { krId }) => {
      qc.invalidateQueries({ queryKey: okrKeys.keyResults(organizationId) })
      qc.invalidateQueries({ queryKey: okrKeys.keyResult(organizationId, krId) })
    },
  })
}

// ── Progress ────────────────────────────────────────────────

export function useUpdateOkrProgress(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ krId, input }: { krId: number; input: OkrProgressUpdateRequest }) =>
      okrProgressApi.update(organizationId, krId, input),
    onSuccess: (_, { krId }) => {
      qc.invalidateQueries({ queryKey: okrKeys.keyResults(organizationId) })
      qc.invalidateQueries({ queryKey: okrKeys.keyResult(organizationId, krId) })
      qc.invalidateQueries({ queryKey: okrKeys.progressHistory(organizationId, krId) })
      qc.invalidateQueries({ queryKey: okrKeys.all(organizationId) })
    },
  })
}

export function useOkrProgressHistory(organizationId: number, krId: number) {
  return useQuery({
    queryKey: okrKeys.progressHistory(organizationId, krId),
    queryFn: () => okrProgressApi.history(organizationId, krId),
    enabled: organizationId > 0 && krId > 0,
  })
}

// ── Alignments ────────────────────────────────────────────────

export function useCreateOkrAlignment(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrAlignmentCreateRequest) =>
      okrAlignmentsApi.create(organizationId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrKeys.all(organizationId) }),
  })
}

// ── Evidence ──────────────────────────────────────────────

export function useOkrEvidence(organizationId: number, query: OkrEvidenceListQuery = {}) {
  return useQuery({
    queryKey: okrKeys.evidenceList(organizationId, query),
    queryFn: () => okrEvidenceApi.list(organizationId, query),
    enabled: organizationId > 0,
  })
}

export function useCreateOkrEvidence(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrEvidenceLinkCreateRequest) =>
      okrEvidenceApi.create(organizationId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrKeys.evidence(organizationId) }),
  })
}

// ── AI Draft ────────────────────────────────────────────

export function useOkrAiDraft(organizationId: number) {
  useQueryClient()
  return useMutation({
    mutationFn: (input: OkrAiDraftRequest) => okrAiDraftApi.generate(organizationId, input),
  })
}

export function useConfirmOkrAiDraft(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrAiDraftConfirmationRequest) =>
      okrAiDraftApi.confirm(organizationId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrKeys.all(organizationId) }),
  })
}

// ── Progress Backflow (v3-okr-progress-backflow) ─────────────────────────

import { okrBackflowApi } from '@/lib/api/okr'
import type { OkrBackflowListQuery, OkrBackflowReasonCode } from '@aiproj/types'

export const okrBackflowKeys = {
  all: (organizationId: number) => [...okrKeys.all(organizationId), 'backflow'] as const,
  suggestions: (organizationId: number) =>
    [...okrBackflowKeys.all(organizationId), 'suggestions'] as const,
  suggestionList: (organizationId: number, query: OkrBackflowListQuery = {}) =>
    [...okrBackflowKeys.suggestions(organizationId), query] as const,
  suggestion: (organizationId: number, suggestionId: number) =>
    [...okrBackflowKeys.suggestions(organizationId), suggestionId] as const,
}

export function useOkrBackflowSuggestions(
  organizationId: number,
  query: OkrBackflowListQuery = {},
) {
  return useQuery({
    queryKey: okrBackflowKeys.suggestionList(organizationId, query),
    queryFn: () => okrBackflowApi.list(organizationId, query),
    enabled: organizationId > 0,
  })
}

export function useOkrBackflowSuggestion(organizationId: number, suggestionId: number) {
  return useQuery({
    queryKey: okrBackflowKeys.suggestion(organizationId, suggestionId),
    queryFn: () => okrBackflowApi.get(organizationId, suggestionId),
    enabled: organizationId > 0 && suggestionId > 0,
  })
}

export function useRecalculateOkrBackflow(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (keyResultId: number) => okrBackflowApi.recalculate(organizationId, keyResultId),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrBackflowKeys.all(organizationId) }),
  })
}

export function useBatchRecalculateOkrBackflow(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { scope: 'objective' | 'cycle'; scopeId: number; maxKrCount?: number }) =>
      okrBackflowApi.batchRecalculate(organizationId, input.scope, input.scopeId, input.maxKrCount),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrBackflowKeys.all(organizationId) }),
  })
}

export function useConfirmOkrBackflow(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { suggestionId: number; note?: string | null }) =>
      okrBackflowApi.confirm(organizationId, input.suggestionId, input.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: okrKeys.keyResults(organizationId) })
      qc.invalidateQueries({ queryKey: okrBackflowKeys.all(organizationId) })
    },
  })
}

export function useRejectOkrBackflow(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      suggestionId: number
      reasonCode: OkrBackflowReasonCode
      reasonNote: string
    }) =>
      okrBackflowApi.reject(organizationId, input.suggestionId, input.reasonCode, input.reasonNote),
    onSuccess: () => qc.invalidateQueries({ queryKey: okrBackflowKeys.all(organizationId) }),
  })
}
