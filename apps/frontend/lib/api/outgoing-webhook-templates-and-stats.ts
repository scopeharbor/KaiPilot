/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板与统计 API 客户端（5.1 P1）。
 *
 * 只读：模板列表/详情/预填。
 * 写：模板应用（创建订阅）——一次性密钥由订阅创建流程返回，本组件不保留。
 */
import { apiFetch } from '@/lib/api-client'
import type {
  OutgoingWebhookTemplateListResponse,
  OutgoingWebhookTemplatePrefillResponse,
  OutgoingWebhookTemplateApplyResponse,
  OutgoingWebhookStatsResponse,
  ApplyOutgoingWebhookTemplateRequest,
} from '@aiproj/types'

export const outgoingWebhookTemplateKeys = {
  all: ['outgoing-webhook-templates'] as const,
  list: () => [...outgoingWebhookTemplateKeys.all, 'list'] as const,
  detail: (id: string) => [...outgoingWebhookTemplateKeys.all, 'detail', id] as const,
  prefill: (id: string) => [...outgoingWebhookTemplateKeys.all, 'prefill', id] as const,
}

export const outgoingWebhookStatsKeys = {
  all: ['outgoing-webhook-stats'] as const,
  index: (params?: { startDate?: string; endDate?: string }) =>
    [...outgoingWebhookStatsKeys.all, 'index', params] as const,
}

export const outgoingWebhookTemplatesApi = {
  list: () => apiFetch<OutgoingWebhookTemplateListResponse>('/outgoing-webhook-templates'),

  show: (id: string) =>
    apiFetch<{ data: import('@aiproj/types').OutgoingWebhookTemplateDto }>(
      `/outgoing-webhook-templates/${encodeURIComponent(id)}`,
    ),

  prefill: (id: string) =>
    apiFetch<OutgoingWebhookTemplatePrefillResponse>(
      `/outgoing-webhook-templates/${encodeURIComponent(id)}/prefill`,
    ),

  apply: (data: ApplyOutgoingWebhookTemplateRequest) =>
    apiFetch<OutgoingWebhookTemplateApplyResponse>('/outgoing-webhook-templates/apply', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

export const outgoingWebhookStatsApi = {
  index: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams()
    if (params?.startDate) searchParams.set('startDate', params.startDate)
    if (params?.endDate) searchParams.set('endDate', params.endDate)
    const qs = searchParams.toString()
    return apiFetch<OutgoingWebhookStatsResponse>(`/outgoing-webhook-stats${qs ? `?${qs}` : ''}`)
  },
}
