'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trizDeliveryLoopApi, trizDeliveryLoopKeys } from '@/lib/api/triz-delivery-loop'
import type { TrizDlPosture } from '@aiproj/types'

/**
 * v3-triz-to-delivery-closed-loop —— React Hooks（task 10.1）。
 *
 * 服务端状态一律 TanStack Query；mutation 成功后按项目前缀精确失效
 * （summary/items/detail 同属本项目 key 前缀）。不做手写缓存。
 */

export function useTrizDeliveryLoopSummary(projectId: number) {
  return useQuery({
    queryKey: trizDeliveryLoopKeys.summary(projectId),
    queryFn: () => trizDeliveryLoopApi.summary(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useTrizDeliveryLoopItems(
  projectId: number,
  filters?: { posture?: TrizDlPosture; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: trizDeliveryLoopKeys.items(projectId, filters),
    queryFn: () => trizDeliveryLoopApi.items(projectId, filters),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useTrizDeliveryLoopDetail(projectId: number, itemId: string | null) {
  return useQuery({
    queryKey: trizDeliveryLoopKeys.detail(projectId, itemId),
    queryFn: () => trizDeliveryLoopApi.detail(projectId, itemId!),
    enabled: Number.isFinite(projectId) && projectId > 0 && !!itemId,
  })
}

/** 项目级精确失效：交付闭环的全部 query key。 */
export function useInvalidateTrizDeliveryLoop(projectId: number) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: [...trizDeliveryLoopKeys.all, 'summary', projectId] })
    void qc.invalidateQueries({ queryKey: [...trizDeliveryLoopKeys.all, 'items', projectId] })
    void qc.invalidateQueries({ queryKey: [...trizDeliveryLoopKeys.all, 'detail', projectId] })
  }
}

export function useLinkPreviewMutation(projectId: number) {
  const invalidate = useInvalidateTrizDeliveryLoop(projectId)
  return useMutation({
    mutationFn: (input: Parameters<typeof trizDeliveryLoopApi.linkPreview>[1]) =>
      trizDeliveryLoopApi.linkPreview(projectId, input),
    onSuccess: invalidate,
  })
}

export function useLinkConfirmMutation(projectId: number) {
  const invalidate = useInvalidateTrizDeliveryLoop(projectId)
  return useMutation({
    mutationFn: (input: Parameters<typeof trizDeliveryLoopApi.linkConfirm>[1]) =>
      trizDeliveryLoopApi.linkConfirm(projectId, input),
    onSuccess: invalidate,
  })
}

export function useVerifyMutation(projectId: number) {
  const invalidate = useInvalidateTrizDeliveryLoop(projectId)
  return useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string
      body: Parameters<typeof trizDeliveryLoopApi.verify>[2]
    }) => trizDeliveryLoopApi.verify(projectId, itemId, body),
    onSuccess: invalidate,
  })
}

export function useReopenMutation(projectId: number) {
  const invalidate = useInvalidateTrizDeliveryLoop(projectId)
  return useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string
      body: Parameters<typeof trizDeliveryLoopApi.reopen>[2]
    }) => trizDeliveryLoopApi.reopen(projectId, itemId, body),
    onSuccess: invalidate,
  })
}
