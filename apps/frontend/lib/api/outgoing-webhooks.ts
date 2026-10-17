import { apiFetch } from '@/lib/api-client'
import type {
  CreateOutgoingWebhookSubscriptionRequest,
  OutgoingWebhookSubscriptionCreatedDto,
  OutgoingWebhookSubscriptionDto,
  OutgoingWebhookSubscriptionRotatedDto,
  OutgoingWebhookSubscriptionStatus,
  UpdateOutgoingWebhookSubscriptionRequest,
} from '@aiproj/types'

/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理 API 客户端。
 * 仅订阅管理面；投递由后续 change 承接。一次性密钥仅在 create/rotate 响应中存在。
 */

export const OUTGOING_WEBHOOK_MANAGE_PERMISSION = 'outgoing_webhook:manage'

export const outgoingWebhookKeys = {
  all: ['outgoing-webhooks'] as const,
  list: () => [...outgoingWebhookKeys.all, 'list'] as const,
}

export const outgoingWebhooksApi = {
  list: () => apiFetch<{ data: OutgoingWebhookSubscriptionDto[] }>('/outgoing-webhooks'),

  create: (data: CreateOutgoingWebhookSubscriptionRequest) =>
    apiFetch<{ data: OutgoingWebhookSubscriptionCreatedDto }>('/outgoing-webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: UpdateOutgoingWebhookSubscriptionRequest) =>
    apiFetch<{ data: OutgoingWebhookSubscriptionDto }>(`/outgoing-webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deactivate: (id: number) =>
    apiFetch<{ data: OutgoingWebhookSubscriptionDto }>(`/outgoing-webhooks/${id}/deactivate`, {
      method: 'POST',
    }),

  rotate: (id: number) =>
    apiFetch<{ data: OutgoingWebhookSubscriptionRotatedDto }>(`/outgoing-webhooks/${id}/rotate`, {
      method: 'POST',
    }),
}

/** 一次性密钥展示态：仅在 create/rotate 成功后短暂持有，dismiss 后清空。 */
export interface OneTimeSecretState {
  secret: string
  fingerprint: string
  rotatedAt: string
}

export type { OutgoingWebhookSubscriptionStatus }
