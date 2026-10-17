/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理入参校验。
 *
 * eventTypes 用 vine.enum 绑定共享白名单，产出 OutgoingWebhookEventType 联合类型，
 * 与 CreateOutgoingWebhookSubscriptionRequest 对齐；URL 保守校验由 service 层承担。
 */
import vine from '@vinejs/vine'
import { OUTGOING_WEBHOOK_EVENT_WHITELIST } from '@aiproj/types'

const nameRegex = /^[\p{L}\p{N}一-龥 _.\-:()]{1,120}$/u

export const createOutgoingWebhookSubscriptionValidator = vine.compile(
  vine.object({
    name: vine.string().trim().regex(nameRegex),
    targetUrl: vine.string().trim().minLength(8).maxLength(2048),
    eventTypes: vine
      .array(vine.enum([...OUTGOING_WEBHOOK_EVENT_WHITELIST]))
      .minLength(1)
      .maxLength(20),
  }),
)

export const updateOutgoingWebhookSubscriptionValidator = vine.compile(
  vine.object({
    name: vine.string().trim().regex(nameRegex).optional(),
    targetUrl: vine.string().trim().minLength(8).maxLength(2048).optional(),
    eventTypes: vine
      .array(vine.enum([...OUTGOING_WEBHOOK_EVENT_WHITELIST]))
      .minLength(1)
      .maxLength(20)
      .optional(),
  }),
)
