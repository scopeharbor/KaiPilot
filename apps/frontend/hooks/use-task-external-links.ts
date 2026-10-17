'use client'

import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { taskExternalLinksApi, taskExternalLinkKeys } from '@/lib/api/task-external-links'
import { useAuthStore } from '@/stores/auth-store'
import type { CreateExternalLinkRequest, UpdateExternalLinkRequest } from '@aiproj/types'

/**
 * v2-github-gitlab-light-links —— 任务外部链接 React Hooks。
 */

export function useTaskExternalLinks(projectId: number, taskId: number) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: taskExternalLinkKeys.list(projectId, taskId),
    queryFn: () => taskExternalLinksApi.list(projectId, taskId),
    enabled: isAuthenticated && !!projectId && !!taskId,
  })
}

export function useCreateTaskExternalLink(projectId: number, taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateExternalLinkRequest) =>
      taskExternalLinksApi.create(projectId, taskId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskExternalLinkKeys.list(projectId, taskId) })
    },
  })
}

export function useUpdateTaskExternalLink(projectId: number, taskId: number, linkId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateExternalLinkRequest) =>
      taskExternalLinksApi.update(projectId, taskId, linkId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskExternalLinkKeys.list(projectId, taskId) })
    },
  })
}

export function useDeleteTaskExternalLink(projectId: number, taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: number) => taskExternalLinksApi.delete(projectId, taskId, linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskExternalLinkKeys.list(projectId, taskId) })
    },
  })
}

export function useRefreshTaskExternalLink(projectId: number, taskId: number) {
  const qc = useQueryClient()
  const inFlightByLinkId = useRef(
    new Map<number, ReturnType<typeof taskExternalLinksApi.refresh>>(),
  )

  return useMutation({
    mutationFn: (linkId: number) => {
      const inFlight = inFlightByLinkId.current.get(linkId)
      if (inFlight) return inFlight

      const request = taskExternalLinksApi.refresh(projectId, taskId, linkId).finally(() => {
        inFlightByLinkId.current.delete(linkId)
      })
      inFlightByLinkId.current.set(linkId, request)
      return request
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskExternalLinkKeys.list(projectId, taskId) })
    },
  })
}
