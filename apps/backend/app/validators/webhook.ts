/**
 * v2-5-provider-incoming-webhook-foundation —— webhook 管理入参校验。
 */
import vine from '@vinejs/vine'

const providerRegex = /^[a-z0-9_-]{1,40}$/
const slugRegex = /^[a-z0-9_-]{1,80}$/

export const createWebhookEndpointValidator = vine.compile(
  vine.object({
    provider: vine.string().trim().regex(providerRegex),
    slug: vine.string().trim().regex(slugRegex),
    timestampToleranceSeconds: vine.number().withoutDecimals().min(0).max(86400).optional(),
    enabled: vine.boolean().optional(),
  }),
)

export const updateWebhookEndpointValidator = vine.compile(
  vine.object({
    timestampToleranceSeconds: vine.number().withoutDecimals().min(0).max(86400).optional(),
    enabled: vine.boolean().optional(),
  }),
)

export const listWebhookDeliveriesValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(100).optional(),
    provider: vine.string().trim().regex(providerRegex).optional(),
  }),
)
