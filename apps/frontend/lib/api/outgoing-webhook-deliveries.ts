import { apiFetch } from '@/lib/api-client'
import { OUTGOING_WEBHOOK_MANAGE_PERMISSION } from '@/lib/api/outgoing-webhooks'
import type {
  ListOutgoingWebhookDeliveriesRequest,
  OutgoingWebhookDeliveryAttemptDto,
  OutgoingWebhookDeliveryEventDto,
  OutgoingWebhookDeliveryListMeta,
  OutgoingWebhookManualRetryResultDto,
  OutgoingWebhookBatchProjectionDto,
} from '@aiproj/types'

/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本 API 客户端。
 * 投递账本 read + manual retry + pause/unpause。复用订阅管理的 outgoing_webhook:manage 权限。
 * 响应统一脱敏投影，无 secret/payload body/signature。
 */

export { OUTGOING_WEBHOOK_MANAGE_PERMISSION }

export type OutgoingWebhookDeliveryListQuery = Partial<ListOutgoingWebhookDeliveriesRequest>

export const outgoingWebhookDeliveryKeys = {
  all: ['outgoing-webhook-deliveries'] as const,
  list: (query?: OutgoingWebhookDeliveryListQuery) =>
    [...outgoingWebhookDeliveryKeys.all, 'list', query ?? {}] as const,
  detail: (id: number) => [...outgoingWebhookDeliveryKeys.all, 'detail', id] as const,
  attempts: (id: number) => [...outgoingWebhookDeliveryKeys.all, 'attempts', id] as const,
}

function buildListSuffix(query?: OutgoingWebhookDeliveryListQuery): string {
  if (!query) return ''
  const qs = new URLSearchParams()
  if (query.subscriptionId !== undefined) qs.set('subscriptionId', String(query.subscriptionId))
  if (query.status) qs.set('status', query.status)
  if (query.page !== undefined) qs.set('page', String(query.page))
  if (query.perPage !== undefined) qs.set('perPage', String(query.perPage))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export const outgoingWebhookDeliveriesApi = {
  list: (query?: OutgoingWebhookDeliveryListQuery) =>
    apiFetch<{ data: OutgoingWebhookDeliveryEventDto[]; meta: OutgoingWebhookDeliveryListMeta }>(
      `/outgoing-webhook-deliveries${buildListSuffix(query)}`,
    ),

  detail: (id: number) =>
    apiFetch<{ data: OutgoingWebhookDeliveryEventDto }>(`/outgoing-webhook-deliveries/${id}`),

  attempts: (id: number) =>
    apiFetch<{ data: OutgoingWebhookDeliveryAttemptDto[] }>(
      `/outgoing-webhook-deliveries/${id}/attempts`,
    ),

  retry: (id: number, reason?: string) =>
    apiFetch<{ data: OutgoingWebhookManualRetryResultDto }>(
      `/outgoing-webhook-deliveries/${id}/retry`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  pause: (id: number) =>
    apiFetch<{ data: OutgoingWebhookDeliveryEventDto }>(
      `/outgoing-webhook-deliveries/${id}/pause`,
      { method: 'POST' },
    ),

  unpause: (id: number) =>
    apiFetch<{ data: OutgoingWebhookDeliveryEventDto }>(
      `/outgoing-webhook-deliveries/${id}/unpause`,
      { method: 'POST' },
    ),

  // v2-5-webhook-batched-delivery: 批量投递 API

  batchList: (query?: {
    page?: number
    perPage?: number
    status?: string
    subscriptionId?: number
  }) => {
    const qs = new URLSearchParams()
    if (query?.page !== undefined) qs.set('page', String(query.page))
    if (query?.perPage !== undefined) qs.set('perPage', String(query.perPage))
    if (query?.status) qs.set('status', query.status)
    if (query?.subscriptionId !== undefined) qs.set('subscriptionId', String(query.subscriptionId))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<{
      data: OutgoingWebhookBatchProjectionDto[]
      meta: OutgoingWebhookDeliveryListMeta
    }>(`/outgoing-webhook-batch-deliveries${suffix}`)
  },

  batchDetail: (batchId: string) =>
    apiFetch<{ data: OutgoingWebhookBatchProjectionDto }>(
      `/outgoing-webhook-batch-deliveries/${encodeURIComponent(batchId)}`,
    ),

  batchRetry: (batchId: string, reason?: string) =>
    apiFetch<{ data: OutgoingWebhookBatchProjectionDto }>(
      `/outgoing-webhook-batch-deliveries/${encodeURIComponent(batchId)}/retry`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
}
