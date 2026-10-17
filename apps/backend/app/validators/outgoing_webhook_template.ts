/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板应用入参校验（3.3 P0）。
 *
 * 复用已有的 name/targetUrl/eventTypes 校验规则，增加 templateId 校验。
 * 遵守 Controller-Service-Validator 分层，模板不定义新的校验规则——只是复用已有规则。
 */
import vine from '@vinejs/vine'
import { OUTGOING_WEBHOOK_EVENT_WHITELIST } from '@aiproj/types'

const nameRegex = /^[\p{L}\p{N}一-龥 _.\-:()]{1,120}$/u

export const applyOutgoingWebhookTemplateValidator = vine.compile(
  vine.object({
    templateId: vine.string().trim().minLength(1).maxLength(128),
    name: vine.string().trim().regex(nameRegex),
    targetUrl: vine.string().trim().minLength(8).maxLength(2048),
    eventTypes: vine
      .array(vine.enum([...OUTGOING_WEBHOOK_EVENT_WHITELIST]))
      .minLength(1)
      .maxLength(20)
      .optional(),
  }),
)

export const getOutgoingWebhookTemplateValidator = vine.compile(
  vine.object({
    id: vine.string().trim().minLength(1).maxLength(128),
  }),
)

export const getOutgoingWebhookTemplatePrefillValidator = vine.compile(
  vine.object({
    id: vine.string().trim().minLength(1).maxLength(128),
  }),
)
