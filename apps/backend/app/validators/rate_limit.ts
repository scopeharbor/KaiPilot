/**
 * v3-global-ai-rate-limiting —— 限流状态查询参数校验。
 */
import vine from '@vinejs/vine'

export const rateLimitStatusValidator = vine.compile(
  vine.object({
    connectionId: vine.number().optional().nullable(),
    modelId: vine.number().optional().nullable(),
  }),
)
