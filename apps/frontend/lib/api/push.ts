import { apiFetch } from '@/lib/api-client'
import type {
  PushCapabilityState,
  PushSubscriptionState,
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushUnsubscribeResponse,
} from '@aiproj/types'

/**
 * Web Push 推送 API（v2-5-pwa-web-push-notifications）。
 *
 * 端点：
 * - GET  /api/v1/push/capability      能力状态（公开）
 * - GET  /api/v1/push/subscription     订阅状态
 * - POST /api/v1/push/subscribe        订阅
 * - POST /api/v1/push/unsubscribe      取消订阅
 */
export const pushApi = {
  /** 获取推送能力状态。 */
  capability: () => apiFetch<PushCapabilityState>('/push/capability'),

  /** 获取当前用户订阅状态。 */
  subscriptionStatus: () => apiFetch<PushSubscriptionState>('/push/subscription'),

  /** 订阅推送。 */
  subscribe: (request: PushSubscribeRequest) =>
    apiFetch<PushSubscribeResponse>('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    }),

  /** 取消订阅。 */
  unsubscribe: (endpoint: string) =>
    apiFetch<PushUnsubscribeResponse>('/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
      headers: { 'Content-Type': 'application/json' },
    }),
}

/**
 * TanStack Query keys。
 */
export const pushKeys = {
  all: ['push'] as const,
  capability: () => [...pushKeys.all, 'capability'] as const,
  subscription: () => [...pushKeys.all, 'subscription'] as const,
}
