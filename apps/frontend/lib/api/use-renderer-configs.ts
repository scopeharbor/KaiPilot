/**
 * use-renderer-configs —— TanStack Query hooks（§5.1 P0）。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  confirmRendererCandidate,
  previewRendererCandidate,
  resetViewOverride,
  saveViewOverride,
  validateRendererConfig,
  type RendererCandidateConfirmRequest,
  type RendererViewOverrideRequest,
} from '@/lib/api/renderer-configs'

export const rendererConfigKeys = {
  all: ['renderer-configs'] as const,
  preview: (projectId: number) => [...rendererConfigKeys.all, 'preview', projectId] as const,
  validate: (projectId: number) => [...rendererConfigKeys.all, 'validate', projectId] as const,
}

export function useValidateRendererConfig(_projectId: number) {
  return useMutation({
    mutationFn: (config: Record<string, unknown>) => validateRendererConfig(config),
  })
}

export function usePreviewRendererCandidate(_projectId: number) {
  return useMutation({
    mutationFn: (config: Record<string, unknown>) => previewRendererCandidate(config),
  })
}

export function useConfirmRendererCandidate(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: RendererCandidateConfirmRequest) =>
      confirmRendererCandidate(projectId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rendererConfigKeys.all })
    },
  })
}

export function useSaveViewOverride(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: RendererViewOverrideRequest) => saveViewOverride(projectId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rendererConfigKeys.all })
    },
  })
}

export function useResetViewOverride(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (viewId: number) => resetViewOverride(projectId, viewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rendererConfigKeys.all })
    },
  })
}
