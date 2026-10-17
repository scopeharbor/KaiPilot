/**
 * v3-unified-ai-feedback-ledger —— 反馈账本查询参数校验。
 */
import vine from '@vinejs/vine'

export const aiFeedbackEventsValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    feedbackType: vine.string().optional(),
    surface: vine.string().optional(),
  }),
)

export const aiFeedbackAggregateValidator = vine.compile(
  vine.object({
    surface: vine.string().optional(),
    windowStart: vine.string().optional(),
    windowEnd: vine.string().optional(),
  }),
)
