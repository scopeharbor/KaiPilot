'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  trizContradictionKeys,
  trizContradictionsApi,
  type ListContradictionsParams,
} from '@/lib/api/triz-contradictions'
import { projectKeys } from '@/lib/api/projects'

export function useTrizContradictions(projectId: number, params?: ListContradictionsParams) {
  return useQuery({
    queryKey: trizContradictionKeys.list(projectId, params),
    queryFn: () => trizContradictionsApi.list(projectId, params),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useTrizContradiction(projectId: number, contradictionId: number) {
  return useQuery({
    queryKey: trizContradictionKeys.detail(projectId, contradictionId),
    queryFn: () => trizContradictionsApi.get(projectId, contradictionId),
    enabled: projectId > 0 && contradictionId > 0,
  })
}

export function useRefreshTrizContradictions(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => trizContradictionsApi.refresh(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizContradictionKeys.all })
      qc.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) })
    },
  })
}

export function useConfirmTrizContradiction(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (contradictionId: number) =>
      trizContradictionsApi.confirm(projectId, contradictionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizContradictionKeys.all })
      qc.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) })
    },
  })
}

export function useDismissTrizContradiction(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contradictionId, reason }: { contradictionId: number; reason: string }) =>
      trizContradictionsApi.dismiss(projectId, contradictionId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizContradictionKeys.all })
      qc.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) })
    },
  })
}

export function useExplainTrizContradiction(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contradictionId, focus }: { contradictionId: number; focus?: string }) =>
      trizContradictionsApi.explain(projectId, contradictionId, focus),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: trizContradictionKeys.detail(projectId, variables.contradictionId),
      })
      qc.invalidateQueries({ queryKey: trizContradictionKeys.all })
    },
  })
}
