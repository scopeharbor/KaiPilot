'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { linkCandidatesApi, linkCandidateKeys } from '@/lib/api/link-candidates'
import { useAuthStore } from '@/stores/auth-store'
import type { ConfirmCandidateRequest, IgnoreCandidateRequest } from '@aiproj/types'

/**
 * v2-5-code-repository-auto-linking —— 链接候选 React Hooks。
 */

export function useLinkCandidates(projectId: number, taskId: number, status?: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: [...linkCandidateKeys.list(projectId, taskId), status].filter(Boolean),
    queryFn: () => linkCandidatesApi.list(projectId, taskId, { status }),
    enabled: isAuthenticated && !!projectId && !!taskId,
  })
}

export function useConfirmLinkCandidate(projectId: number, taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ candidateId, data }: { candidateId: number; data?: ConfirmCandidateRequest }) =>
      linkCandidatesApi.confirm(projectId, taskId, candidateId, data),
    onSuccess: () => {
      // 失效候选列表 + 外部链接列表（确认后产生正式外链）
      qc.invalidateQueries({ queryKey: linkCandidateKeys.list(projectId, taskId) })
      qc.invalidateQueries({ queryKey: ['task-external-links', 'list', projectId, taskId] })
    },
  })
}

export function useIgnoreLinkCandidate(projectId: number, taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ candidateId, data }: { candidateId: number; data?: IgnoreCandidateRequest }) =>
      linkCandidatesApi.ignore(projectId, taskId, candidateId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: linkCandidateKeys.list(projectId, taskId) })
    },
  })
}
