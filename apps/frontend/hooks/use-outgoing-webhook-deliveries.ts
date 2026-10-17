'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  outgoingWebhookDeliveriesApi,
  outgoingWebhookDeliveryKeys,
  type OutgoingWebhookDeliveryListQuery,
} from '@/lib/api/outgoing-webhook-deliveries'
import { useAuthStore } from '@/stores/auth-store'

/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本 React Hooks。
 * read + manual retry + pause/unpause。写操作成功后失效 list/detail/attempts 缓存。
 */

export function useOutgoingWebhookDeliveries(query?: OutgoingWebhookDeliveryListQuery) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookDeliveryKeys.list(query),
    queryFn: () => outgoingWebhookDeliveriesApi.list(query),
    enabled: isAuthenticated,
  })
}

export function useOutgoingWebhookDeliveryDetail(id: number | null) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookDeliveryKeys.detail(id ?? 0),
    queryFn: () => outgoingWebhookDeliveriesApi.detail(id as number),
    enabled: isAuthenticated && id !== null,
  })
}

export function useOutgoingWebhookDeliveryAttempts(id: number | null) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookDeliveryKeys.attempts(id ?? 0),
    queryFn: () => outgoingWebhookDeliveriesApi.attempts(id as number),
    enabled: isAuthenticated && id !== null,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: number) {
  qc.invalidateQueries({ queryKey: outgoingWebhookDeliveryKeys.all })
  if (id !== undefined) {
    qc.invalidateQueries({ queryKey: outgoingWebhookDeliveryKeys.detail(id) })
    qc.invalidateQueries({ queryKey: outgoingWebhookDeliveryKeys.attempts(id) })
  }
}

export function useManualRetryOutgoingWebhookDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      outgoingWebhookDeliveriesApi.retry(id, reason),
    onSuccess: (_data, vars) => invalidateAll(qc, vars.id),
  })
}

export function usePauseOutgoingWebhookDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => outgoingWebhookDeliveriesApi.pause(id),
    onSuccess: (_data, id) => invalidateAll(qc, id),
  })
}

export function useUnpauseOutgoingWebhookDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => outgoingWebhookDeliveriesApi.unpause(id),
    onSuccess: (_data, id) => invalidateAll(qc, id),
  })
}

// v2-5-webhook-batched-delivery: 批量投递 hooks

export const outgoingWebhookBatchDeliveryKeys = {
  all: ['outgoing-webhook-batch-deliveries'] as const,
  list: (query?: Record<string, unknown>) =>
    [...outgoingWebhookBatchDeliveryKeys.all, 'list', query ?? {}] as const,
  detail: (batchId: string) =>
    [...outgoingWebhookBatchDeliveryKeys.all, 'detail', batchId] as const,
}

export function useOutgoingWebhookBatchDeliveries(query?: {
  page?: number
  perPage?: number
  status?: string
  subscriptionId?: number
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookBatchDeliveryKeys.list(query as Record<string, unknown>),
    queryFn: () => outgoingWebhookDeliveriesApi.batchList(query),
    enabled: isAuthenticated,
  })
}

export function useOutgoingWebhookBatchDeliveryDetail(batchId: string | null) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookBatchDeliveryKeys.detail(batchId ?? ''),
    queryFn: () => outgoingWebhookDeliveriesApi.batchDetail(batchId as string),
    enabled: isAuthenticated && batchId !== null,
  })
}

export function useManualRetryOutgoingWebhookBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ batchId, reason }: { batchId: string; reason?: string }) =>
      outgoingWebhookDeliveriesApi.batchRetry(batchId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outgoingWebhookBatchDeliveryKeys.all })
    },
  })
}
