import vine from '@vinejs/vine'

/**
 * OCR 审查确认流——请求验证器（v3-ocr-review-confirmation-flow §4.1）。
 */

/** 审查详情读取过滤器 */
export const ocrReviewFilterValidator = vine.compile(
  vine.object({
    includeAccepted: vine.boolean().optional(),
  }),
)

/** 选择请求 */
export const ocrReviewSelectionValidator = vine.compile(
  vine.object({
    candidateId: vine.number().positive(),
    mode: vine.enum(['full', 'partial', 'page']),
    selectedText: vine.string().trim().minLength(1).maxLength(100000),
    pageRefs: vine.array(vine.number().min(0)).minLength(1).maxLength(500),
  }),
)

/** 确认预览请求 */
export const ocrConfirmationPreviewValidator = vine.compile(
  vine.object({
    selection: vine.object({
      candidateId: vine.number().positive(),
      mode: vine.enum(['full', 'partial', 'page']),
      selectedText: vine.string().trim().minLength(1).maxLength(100000),
      pageRefs: vine.array(vine.number().min(0)).minLength(1).maxLength(500),
    }),
    reviewNote: vine.string().trim().maxLength(2000).optional(),
  }),
)

/** 确认保存请求 */
export const ocrConfirmationSaveValidator = vine.compile(
  vine.object({
    previewHash: vine.string().trim().minLength(1).maxLength(128),
    selection: vine.object({
      candidateId: vine.number().positive(),
      mode: vine.enum(['full', 'partial', 'page']),
      selectedText: vine.string().trim().minLength(1).maxLength(100000),
      pageRefs: vine.array(vine.number().min(0)).minLength(1).maxLength(500),
    }),
    reviewNote: vine.string().trim().maxLength(2000).optional(),
  }),
)

/** 已接受提取列表过滤器 */
export const ocrAcceptedExtractionListValidator = vine.compile(
  vine.object({
    sourceKind: vine.enum(['attachment', 'document']).optional(),
    sourceId: vine.number().positive().optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)
