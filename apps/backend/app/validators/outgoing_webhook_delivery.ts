/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本入参校验。
 *
 * vine 只做基础格式校验；组织隔离、重试资格、暂停态、事件白名单由 service 层承担。
 */
import vine from '@vinejs/vine'

export const listOutgoingWebhookDeliveriesValidator = vine.compile(
  vine.object({
    subscriptionId: vine.number().withoutDecimals().positive().optional(),
    status: vine
      .string()
      .trim()
      .in(['pending', 'in_progress', 'success', 'failed', 'paused'])
      .optional(),
    page: vine.number().withoutDecimals().positive().optional(),
    perPage: vine.number().withoutDecimals().positive().max(100).optional(),
  }),
)

export const manualRetryOutgoingWebhookDeliveryValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().maxLength(255).optional(),
  }),
)
