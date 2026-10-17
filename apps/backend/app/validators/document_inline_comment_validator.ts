import vine from '@vinejs/vine'

/**
 * 文档内联批注 Validators（v3-document-inline-comments §4.3）。
 */

/** 创建内联批注 anchor + root comment。 */
export const createInlineCommentValidator = vine.compile(
  vine.object({
    rangeStart: vine.number().min(0),
    rangeEnd: vine.number().min(0),
    selectedQuote: vine.string().trim().maxLength(500),
    documentVersion: vine.string().trim().maxLength(255),
    body: vine.string().trim().minLength(1).maxLength(5000),
    bodyFormat: vine.enum(['plain', 'markdown']).optional(),
    mentions: vine.array(vine.number()).optional(),
  }),
)

/** 回复内联批注。 */
export const createReplyValidator = vine.compile(
  vine.object({
    body: vine.string().trim().minLength(1).maxLength(5000),
    bodyFormat: vine.enum(['plain', 'markdown']).optional(),
    mentions: vine.array(vine.number()).optional(),
  }),
)

/** 重设锚点。 */
export const reanchorValidator = vine.compile(
  vine.object({
    rangeStart: vine.number().min(0),
    rangeEnd: vine.number().min(0),
    selectedQuote: vine.string().trim().maxLength(500),
    documentVersion: vine.string().trim().maxLength(255),
  }),
)

/** 列表查询。 */
export const listInlineCommentsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    sort: vine.string().in(['created_at', 'updated_at', 'range_start', 'stale_status']).optional(),
    staleFilter: vine.string().in(['all', 'fresh', 'stale']).optional(),
    threadStatus: vine.string().in(['open', 'resolved']).optional(),
  }),
)

export type CreateInlineCommentRequest = Parameters<typeof createInlineCommentValidator.validate>[0]
export type CreateReplyRequest = Parameters<typeof createReplyValidator.validate>[0]
export type ReanchorRequest = Parameters<typeof reanchorValidator.validate>[0]
export type ListInlineCommentsRequest = Parameters<typeof listInlineCommentsValidator.validate>[0]
