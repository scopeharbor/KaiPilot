import vine from '@vinejs/vine'

/**
 * v2-ai-risk-progress-prediction — 预测相关 VineJS validators。
 */

const windowValidator = vine.number().withoutDecimals().range([7, 90])

export const createPredictionValidator = vine.compile(
  vine.object({
    window: windowValidator,
  }),
)

export const listPredictionsValidator = vine.compile(
  vine.object({
    status: vine.string().optional(),
    window: vine.number().withoutDecimals().optional(),
    page: vine.number().withoutDecimals().optional(),
    perPage: vine.number().withoutDecimals().optional(),
    sort: vine.string().optional(),
  }),
)

export const confirmPredictionValidator = vine.compile(
  vine.object({
    notes: vine.string().maxLength(500).optional().nullable(),
  }),
)

export const dismissPredictionValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(1).maxLength(500),
  }),
)

export const generateAiExplanationValidator = vine.compile(
  vine.object({
    idempotencyKey: vine.string().maxLength(64).optional(),
  }),
)

export const approveAiExplanationValidator = vine.compile(
  vine.object({
    notes: vine.string().maxLength(500).optional().nullable(),
  }),
)

export const rejectAiExplanationValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(1).maxLength(500),
  }),
)
