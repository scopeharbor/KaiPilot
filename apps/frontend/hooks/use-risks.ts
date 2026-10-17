'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRisks,
  createRisk,
  updateRisk,
  deleteRisk,
  transitionRiskStatus,
  type RiskListFilters,
  type Risk,
  type RiskStatus,
} from '@/lib/api/risks'

const riskKeys = {
  all: ['risks'] as const,
  lists: () => [...riskKeys.all, 'list'] as const,
  list: (projectId: number, filters?: RiskListFilters) =>
    [...riskKeys.lists(), projectId, filters] as const,
  details: () => [...riskKeys.all, 'detail'] as const,
  detail: (projectId: number, riskId: number) =>
    [...riskKeys.details(), projectId, riskId] as const,
}

export function useRiskList(projectId: number, filters: RiskListFilters = {}) {
  return useQuery({
    queryKey: riskKeys.list(projectId, filters),
    queryFn: () => listRisks(projectId, filters),
    enabled: !!projectId,
  })
}

export function useCreateRisk(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Risk> & { title: string; description: string }) =>
      createRisk(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.lists() })
    },
  })
}

export function useUpdateRisk(projectId: number, riskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Risk>) => updateRisk(projectId, riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(projectId, riskId) })
    },
  })
}

export function useDeleteRisk(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (riskId: number) => deleteRisk(projectId, riskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.lists() })
    },
  })
}

export function useTransitionRiskStatus(projectId: number, riskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (status: RiskStatus) => transitionRiskStatus(projectId, riskId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(projectId, riskId) })
    },
  })
}
