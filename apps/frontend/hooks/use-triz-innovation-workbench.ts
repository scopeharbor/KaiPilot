'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  trizInnovationApi,
  trizInnovationKeys,
  type InnovationHandoffRequest,
  type UpdateInnovationSchemeRequest,
} from '@/lib/api/triz-innovation-workbench'
import type {
  AddOptionRequest,
  CreateInnovationSchemeRequest,
  InnovationSchemeStatus,
} from '@aiproj/types'

/**
 * v3-triz-innovation-workbench —— TanStack Query hooks。
 *
 * 读取 hooks 不触发生成/比较/handoff；所有会写工作台元数据的动作都用 mutation。
 */

function enabledProject(projectId: number) {
  return Number.isFinite(projectId) && projectId > 0
}

function invalidateWorkbench(client: ReturnType<typeof useQueryClient>, projectId: number) {
  client.invalidateQueries({ queryKey: trizInnovationKeys.all })
  client.invalidateQueries({ queryKey: ['projects', projectId, 'dashboard'] })
}

export function useTrizInnovationSources(
  projectId: number,
  options: { includeDraft?: boolean; enabled?: boolean } = {},
) {
  const includeDraft = options.includeDraft ?? false
  return useQuery({
    queryKey: trizInnovationKeys.sources(projectId, includeDraft),
    queryFn: () => trizInnovationApi.sources(projectId, { includeDraft }),
    enabled: enabledProject(projectId) && (options.enabled ?? true),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useTrizInnovationSchemes(
  projectId: number,
  filters: { page?: number; perPage?: number; status?: InnovationSchemeStatus } = {},
) {
  return useQuery({
    queryKey: trizInnovationKeys.schemes(projectId, filters),
    queryFn: () => trizInnovationApi.listSchemes(projectId, filters),
    enabled: enabledProject(projectId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useTrizInnovationScheme(projectId: number, schemeId: string | null) {
  return useQuery({
    queryKey: trizInnovationKeys.detail(projectId, schemeId ?? ''),
    queryFn: () => trizInnovationApi.detail(projectId, schemeId!),
    enabled: enabledProject(projectId) && Boolean(schemeId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useCreateTrizInnovationScheme(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateInnovationSchemeRequest) =>
      trizInnovationApi.createScheme(projectId, payload),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useUpdateTrizInnovationScheme(projectId: number, schemeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateInnovationSchemeRequest) =>
      trizInnovationApi.updateScheme(projectId, schemeId, payload),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useAbandonTrizInnovationScheme(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (schemeId: string) => trizInnovationApi.abandonScheme(projectId, schemeId),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useAddTrizInnovationOption(projectId: number, schemeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: AddOptionRequest) =>
      trizInnovationApi.addOption(projectId, schemeId, payload),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useRemoveTrizInnovationOption(projectId: number, schemeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (optionId: string) => trizInnovationApi.removeOption(projectId, schemeId, optionId),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useCompareTrizInnovationScheme(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (schemeId: string) => trizInnovationApi.compare(projectId, schemeId),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useGenerateTrizInnovationNarrative(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (schemeId: string) => trizInnovationApi.narrative(projectId, schemeId),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}

export function useTrizInnovationDraftHandoff(projectId: number, schemeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload?: InnovationHandoffRequest) =>
      trizInnovationApi.draftHandoff(projectId, schemeId, payload ?? {}),
    onSuccess: () => invalidateWorkbench(client, projectId),
  })
}
