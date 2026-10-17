/**
 * v3-triz-ifr-visualization —— IFR TanStack Query hooks（tasks 5.1 P0）。
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { trizIfrApi } from '@/lib/api/triz-ifr-visualization'
import type {
  IfrPreviewResponse,
  IfrListResponse,
  IfrDetailResponse,
  IfrAiDraftResponse,
  IfrFreshnessResponse,
  IfrHandoffCandidateResponse,
  IfrSaveRequest,
  IfrAiDraftRequest,
  IfrHandoffRequest,
} from '@aiproj/types'

// ── Query Keys ──

export const trizIfrKeys = {
  all: (projectId: number) => ['triz', 'ifr', projectId] as const,
  preview: (projectId: number) => [...trizIfrKeys.all(projectId), 'preview'] as const,
  list: (projectId: number, page: number) => [...trizIfrKeys.all(projectId), 'list', page] as const,
  detail: (projectId: number, ifrId: string) =>
    [...trizIfrKeys.all(projectId), 'detail', ifrId] as const,
  freshness: (projectId: number, ifrId: string) =>
    [...trizIfrKeys.all(projectId), 'freshness', ifrId] as const,
}

// ── Hooks ──

/** IFR 预览（只读）。 */
export function useTrizIfrPreview(
  projectId: number,
  params?: {
    currentState?: string
    idealState?: string
    usefulFunction?: number
    cost?: number
    harm?: number
  },
) {
  return useQuery<IfrPreviewResponse>({
    queryKey: trizIfrKeys.preview(projectId),
    queryFn: () => trizIfrApi.getPreview(projectId, params),
    enabled: projectId > 0,
  })
}

/** IFR 已保存审查列表。 */
export function useTrizIfrList(projectId: number, page = 1) {
  return useQuery<IfrListResponse>({
    queryKey: trizIfrKeys.list(projectId, page),
    queryFn: () => trizIfrApi.list(projectId, page),
    enabled: projectId > 0,
  })
}

/** IFR 审查详情。 */
export function useTrizIfrDetail(projectId: number, ifrId: string | null) {
  return useQuery<IfrDetailResponse>({
    queryKey: trizIfrKeys.detail(projectId, ifrId ?? ''),
    queryFn: () => trizIfrApi.detail(projectId, ifrId!),
    enabled: projectId > 0 && !!ifrId,
  })
}

/** IFR 新鲜度。 */
export function useTrizIfrFreshness(projectId: number, ifrId: string | null) {
  return useQuery<IfrFreshnessResponse>({
    queryKey: trizIfrKeys.freshness(projectId, ifrId ?? ''),
    queryFn: () => trizIfrApi.freshness(projectId, ifrId!),
    enabled: projectId > 0 && !!ifrId,
  })
}

// ── Mutations ──

/** 保存 IFR 审查。 */
export function useSaveTrizIfrReview(projectId: number) {
  const qc = useQueryClient()
  return useMutation<IfrDetailResponse, Error, IfrSaveRequest>({
    mutationFn: (body) => trizIfrApi.save(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizIfrKeys.all(projectId) })
    },
  })
}

/** AI IFR 草稿。 */
export function useTrizIfrAiDraft(projectId: number) {
  return useMutation<IfrAiDraftResponse, Error, IfrAiDraftRequest>({
    mutationFn: (body) => trizIfrApi.aiDraft(projectId, body),
  })
}

/** Handoff preview。 */
export function useTrizIfrHandoffPreview(projectId: number, ifrId: string) {
  return useMutation<IfrHandoffCandidateResponse, Error, IfrHandoffRequest>({
    mutationFn: (body) => trizIfrApi.handoffPreview(projectId, ifrId, body),
  })
}

/** Handoff candidate。 */
export function useTrizIfrHandoffCandidate(projectId: number, ifrId: string) {
  const qc = useQueryClient()
  return useMutation<IfrHandoffCandidateResponse, Error, IfrHandoffRequest>({
    mutationFn: (body) => trizIfrApi.handoffCandidate(projectId, ifrId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trizIfrKeys.all(projectId) })
    },
  })
}
