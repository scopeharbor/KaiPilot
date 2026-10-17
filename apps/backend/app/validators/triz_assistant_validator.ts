import vine from '@vinejs/vine'

/**
 * AI-TRIZ 助手 Validators（v3-ai-triz-assistant §3.8）。
 */

export const submitMessageValidator = vine.compile(
  vine.object({
    message: vine.string().trim().minLength(1).maxLength(5000),
    selectedSourceRefs: vine.array(vine.string()).optional(),
    idempotencyKey: vine.string().optional(),
    enableAi: vine.boolean().optional(),
  }),
)

export const listRunsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.string().optional(),
    sort: vine.string().optional(),
  }),
)

export const runDetailValidator = vine.compile(
  vine.object({
    runId: vine.string(),
  }),
)

export const feedbackValidator = vine.compile(
  vine.object({
    reason: vine
      .string()
      .in(['helpful', 'not_helpful', 'incorrect_route', 'missing_context', 'outdated', 'other']),
    comment: vine.string().maxLength(1000).optional(),
  }),
)

export const previewValidator = vine.compile(
  vine.object({
    actionId: vine.string(),
    sourceHashes: vine.array(vine.string()),
  }),
)

export type AssistantSubmitMessageRequest = Parameters<typeof submitMessageValidator.validate>[0]
export type AssistantListRunsRequest = Parameters<typeof listRunsValidator.validate>[0]
export type AssistantRunDetailRequest = Parameters<typeof runDetailValidator.validate>[0]
export type AssistantFeedbackRequest = Parameters<typeof feedbackValidator.validate>[0]
export type AssistantPreviewRequest = Parameters<typeof previewValidator.validate>[0]
