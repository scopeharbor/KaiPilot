import vine from '@vinejs/vine'
import {
  OCR_DOCUMENT_SOURCE_KINDS,
  OCR_DOCUMENT_MAX_PROMPT_CHARS,
  OCR_DOCUMENT_MAX_PAGES,
} from '@aiproj/types'

const sourceKindRule = vine.enum(OCR_DOCUMENT_SOURCE_KINDS)

export const ocrDocumentJobCreateValidator = vine.compile(
  vine.object({
    sourceKind: sourceKindRule.optional(),
    sourceAttachmentId: vine.number().min(1).nullable().optional(),
    connectionId: vine.number().min(1).nullable().optional(),
    modelId: vine.number().min(1).nullable().optional(),
    promptHint: vine.string().maxLength(OCR_DOCUMENT_MAX_PROMPT_CHARS).nullable().optional(),
    idempotencyKey: vine.string().maxLength(256).nullable().optional(),
    pageLimit: vine.number().min(1).max(OCR_DOCUMENT_MAX_PAGES).nullable().optional(),
  }),
)

export const ocrDocumentJobListValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    sort: vine.string().optional(),
    status: vine.string().optional(),
  }),
)

export const ocrDocumentJobRetryValidator = vine.compile(
  vine.object({
    connectionId: vine.number().min(1).nullable().optional(),
    modelId: vine.number().min(1).nullable().optional(),
    promptHint: vine.string().maxLength(OCR_DOCUMENT_MAX_PROMPT_CHARS).nullable().optional(),
    pageLimit: vine.number().min(1).max(OCR_DOCUMENT_MAX_PAGES).nullable().optional(),
  }),
)

export const ocrDocumentConfirmationValidator = vine.compile(
  vine.object({
    candidateIds: vine.array(vine.number().min(1)).minLength(1),
    selectedText: vine.string().nullable().optional(),
    pageRefs: vine.array(vine.number().min(0)).nullable().optional(),
    reviewNote: vine.string().maxLength(1000).nullable().optional(),
  }),
)
