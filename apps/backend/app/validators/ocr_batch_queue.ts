import vine from '@vinejs/vine'
import { OCR_BATCH_DEFAULT_MAX_SOURCES, OCR_BATCH_DEFAULT_MAX_PAGES_PER_BATCH } from '@aiproj/types'

/**
 * Batch create validator: bounded sources, optional model/options, idempotency key.
 */
export const ocrBatchCreateValidator = vine.compile(
  vine.object({
    sources: vine
      .array(
        vine.object({
          sourceAttachmentId: vine.number().min(1),
          sourceKind: vine.enum(['upload', 'attachment']).optional(),
        }),
      )
      .minLength(1)
      .maxLength(OCR_BATCH_DEFAULT_MAX_SOURCES),
    connectionId: vine.number().min(1).nullable().optional(),
    modelId: vine.number().min(1).nullable().optional(),
    promptHint: vine.string().maxLength(500).nullable().optional(),
    pageLimit: vine
      .number()
      .min(1)
      .max(OCR_BATCH_DEFAULT_MAX_PAGES_PER_BATCH)
      .nullable()
      .optional(),
    idempotencyKey: vine.string().maxLength(256).nullable().optional(),
  }),
)

/**
 * Batch list filters.
 */
export const ocrBatchListValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.string().optional(),
    sort: vine.string().optional(),
  }),
)

/**
 * Queue list filters.
 */
export const ocrQueueListValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.string().optional(),
    batchId: vine.number().min(1).optional(),
    sort: vine.string().optional(),
  }),
)

/**
 * Batch retry request.
 */
export const ocrBatchRetryValidator = vine.compile(
  vine.object({
    controlKey: vine.string().maxLength(256).nullable().optional(),
    sourceAttachmentIds: vine.array(vine.number().min(1)).nullable().optional(),
    connectionId: vine.number().min(1).nullable().optional(),
    modelId: vine.number().min(1).nullable().optional(),
  }),
)

/**
 * Batch cancel request.
 */
export const ocrBatchCancelValidator = vine.compile(
  vine.object({
    controlKey: vine.string().maxLength(256).nullable().optional(),
    reason: vine.string().maxLength(500).nullable().optional(),
  }),
)

/**
 * Batch resume request.
 */
export const ocrBatchResumeValidator = vine.compile(
  vine.object({
    controlKey: vine.string().maxLength(256).nullable().optional(),
    connectionId: vine.number().min(1).nullable().optional(),
    modelId: vine.number().min(1).nullable().optional(),
  }),
)
