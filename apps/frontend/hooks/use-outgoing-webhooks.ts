'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { outgoingWebhooksApi, outgoingWebhookKeys } from '@/lib/api/outgoing-webhooks'
import { useAuthStore } from '@/stores/auth-store'
import type {
  CreateOutgoingWebhookSubscriptionRequest,
  OutgoingWebhookSubscriptionCreatedDto,
  OutgoingWebhookSubscriptionRotatedDto,
  UpdateOutgoingWebhookSubscriptionRequest,
} from '@aiproj/types'

/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅 React Hooks。
 * 一次性密钥仅在 create/rotate 成功态返回，调用方须立即展示并 dismiss 后不再保留。
 */

export function useOutgoingWebhooks() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookKeys.list(),
    queryFn: () => outgoingWebhooksApi.list(),
    enabled: isAuthenticated,
  })
}

export function useCreateOutgoingWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateOutgoingWebhookSubscriptionRequest) =>
      outgoingWebhooksApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outgoingWebhookKeys.list() })
    },
  })
}

export function useUpdateOutgoingWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateOutgoingWebhookSubscriptionRequest }) =>
      outgoingWebhooksApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outgoingWebhookKeys.list() })
    },
  })
}

export function useDeactivateOutgoingWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => outgoingWebhooksApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outgoingWebhookKeys.list() })
    },
  })
}

export function useRotateOutgoingWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => outgoingWebhooksApi.rotate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outgoingWebhookKeys.list() })
    },
  })
}

export type { OutgoingWebhookSubscriptionCreatedDto, OutgoingWebhookSubscriptionRotatedDto }
