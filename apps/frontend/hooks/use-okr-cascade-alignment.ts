// OKR 级联与对齐 TanStack Query Hooks
// v3-okr-cascade-and-alignment §5.1

'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCascadePlan,
  listCascadePlans,
  getCascadePlan,
  confirmCascadeItems,
  rejectCascadeItems,
  createRelation,
  listRelations,
  getRelation,
  updateRelation,
  archiveRelation,
  getHealth,
  listHealth,
  getMatrix,
  generateAiCascadeSuggestions,
} from '@/lib/okr-cascade-alignment-api'
import type {
  OkrCascadePlanCreateRequest,
  OkrCascadePlanItemConfirmRequest,
  OkrCascadePlanItemRejectRequest,
  OkrRelationCreateRequest,
  OkrRelationUpdateRequest,
  OkrHealthQuery,
  OkrAlignmentMatrixQuery,
  OkrAiCascadeSuggestionRequest,
} from '@aiproj/types'

// ── Query Key Factory ──────────────────────────────────────────────────────

export const okrCascadeKeys = {
  all: ['okr-cascade'] as const,
  plans: (orgId: number) => [...okrCascadeKeys.all, 'plans', orgId] as const,
  planDetail: (orgId: number, planId: number) =>
    [...okrCascadeKeys.all, 'plans', orgId, planId] as const,
  relations: (orgId: number) => [...okrCascadeKeys.all, 'relations', orgId] as const,
  relationDetail: (orgId: number, relationId: number) =>
    [...okrCascadeKeys.all, 'relations', orgId, relationId] as const,
  health: (orgId: number) => [...okrCascadeKeys.all, 'health', orgId] as const,
  healthDetail: (orgId: number, objectiveId: number) =>
    [...okrCascadeKeys.all, 'health', orgId, objectiveId] as const,
  matrix: (orgId: number, query: OkrAlignmentMatrixQuery) =>
    [...okrCascadeKeys.all, 'matrix', orgId, query] as const,
  aiSuggestions: (orgId: number) => [...okrCascadeKeys.all, 'ai-suggestions', orgId] as const,
}

// ── Cascade Plan Hooks ─────────────────────────────────────────────────────

export function useCascadePlans(
  organizationId: number,
  params?: { status?: string; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: okrCascadeKeys.plans(organizationId),
    queryFn: () => listCascadePlans(organizationId, params),
    enabled: organizationId > 0,
  })
}

export function useCascadePlan(organizationId: number, planId: number) {
  return useQuery({
    queryKey: okrCascadeKeys.planDetail(organizationId, planId),
    queryFn: () => getCascadePlan(organizationId, planId),
    enabled: organizationId > 0 && planId > 0,
  })
}

export function useCreateCascadePlan(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrCascadePlanCreateRequest) => createCascadePlan(organizationId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.plans(organizationId) })
    },
  })
}

export function useConfirmCascadeItems(organizationId: number, planId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrCascadePlanItemConfirmRequest) =>
      confirmCascadeItems(organizationId, planId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.planDetail(organizationId, planId) })
    },
  })
}

export function useRejectCascadeItems(organizationId: number, planId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrCascadePlanItemRejectRequest) =>
      rejectCascadeItems(organizationId, planId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.planDetail(organizationId, planId) })
    },
  })
}

// ── Relation Hooks ─────────────────────────────────────────────────────────

export function useRelations(
  organizationId: number,
  params?: {
    sourceObjectiveId?: number
    targetObjectiveId?: number
    relationType?: string
    status?: string
    page?: number
    perPage?: number
  },
) {
  return useQuery({
    queryKey: okrCascadeKeys.relations(organizationId),
    queryFn: () => listRelations(organizationId, params),
    enabled: organizationId > 0,
  })
}

export function useRelation(organizationId: number, relationId: number) {
  return useQuery({
    queryKey: okrCascadeKeys.relationDetail(organizationId, relationId),
    queryFn: () => getRelation(organizationId, relationId),
    enabled: organizationId > 0 && relationId > 0,
  })
}

export function useCreateRelation(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrRelationCreateRequest) => createRelation(organizationId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.relations(organizationId) })
    },
  })
}

export function useUpdateRelation(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ relationId, input }: { relationId: number; input: OkrRelationUpdateRequest }) =>
      updateRelation(organizationId, relationId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.relations(organizationId) })
    },
  })
}

export function useArchiveRelation(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (relationId: number) => archiveRelation(organizationId, relationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.relations(organizationId) })
    },
  })
}

// ── Health Hooks ───────────────────────────────────────────────────────────

export function useHealth(organizationId: number, objectiveId: number) {
  return useQuery({
    queryKey: okrCascadeKeys.healthDetail(organizationId, objectiveId),
    queryFn: () => getHealth(organizationId, objectiveId),
    enabled: organizationId > 0 && objectiveId > 0,
  })
}

export function useHealthList(organizationId: number, query: OkrHealthQuery) {
  return useQuery({
    queryKey: okrCascadeKeys.health(organizationId),
    queryFn: () => listHealth(organizationId, query),
    enabled: organizationId > 0,
  })
}

// ── Matrix Hooks ───────────────────────────────────────────────────────────

export function useMatrix(organizationId: number, query: OkrAlignmentMatrixQuery) {
  return useQuery({
    queryKey: okrCascadeKeys.matrix(organizationId, query),
    queryFn: () => getMatrix(organizationId, query),
    enabled: organizationId > 0,
  })
}

// ── AI Cascade Suggestion Hooks ────────────────────────────────────────────

export function useAiCascadeSuggestions(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OkrAiCascadeSuggestionRequest) =>
      generateAiCascadeSuggestions(organizationId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: okrCascadeKeys.aiSuggestions(organizationId) })
    },
  })
}
