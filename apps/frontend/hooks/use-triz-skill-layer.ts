/**
 * TRIZ Skill Layer TanStack Query hooks (v3-triz-skill-layer-integration §4.2)
 */
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  fetchTrizSkillLayerSummary,
  fetchTrizSkillLayerDestinations,
  postTrizSkillLayerRoutePreview,
  postTrizSkillLayerHandoffPreview,
  type TrizSkillLayerDestinationsParams,
} from '@/lib/api/triz-skill-layer'
import type { TrizRoutePreviewRequest, TrizHandoffPreviewRequest } from '@aiproj/types'

// ── Query Keys ───────────────────────────────────────────────────────

export const trizSkillLayerKeys = {
  all: ['triz-skill-layer'] as const,
  summary: (projectId: number | string) =>
    [...trizSkillLayerKeys.all, 'summary', projectId] as const,
  destinations: (projectId: number | string, params?: TrizSkillLayerDestinationsParams) =>
    [...trizSkillLayerKeys.all, 'destinations', projectId, params] as const,
}

// ── Summary ──────────────────────────────────────────────────────────

export function useTrizSkillLayerSummary(projectId: number | string, enabled = true) {
  return useQuery({
    queryKey: trizSkillLayerKeys.summary(projectId),
    queryFn: () => fetchTrizSkillLayerSummary(projectId),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 分钟缓存
  })
}

// ── Destinations ─────────────────────────────────────────────────────

export function useTrizSkillLayerDestinations(
  projectId: number | string,
  params?: TrizSkillLayerDestinationsParams,
  enabled = true,
) {
  return useQuery({
    queryKey: trizSkillLayerKeys.destinations(projectId, params),
    queryFn: () => fetchTrizSkillLayerDestinations(projectId, params),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

// ── Route Preview Mutation ───────────────────────────────────────────

export function useTrizSkillLayerRoutePreview(projectId: number | string) {
  // preview 为只读操作，不 invalidate summary/destinations，故不取 queryClient
  return useMutation({
    mutationFn: (input: TrizRoutePreviewRequest) =>
      postTrizSkillLayerRoutePreview(projectId, input),
  })
}

// ── Handoff Preview Mutation ─────────────────────────────────────────

export function useTrizSkillLayerHandoffPreview(projectId: number | string) {
  // preview 为只读操作，不 invalidate summary/destinations，故不取 queryClient
  return useMutation({
    mutationFn: (input: TrizHandoffPreviewRequest) =>
      postTrizSkillLayerHandoffPreview(projectId, input),
  })
}
