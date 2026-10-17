/**
 * 文档全文搜索管理端点 validators（v3-document-full-text-search §8.1）
 */
import vine from '@vinejs/vine'

export const documentSearchStatusValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive().withoutDecimals(),
  }),
)

export const documentSearchReindexValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive().withoutDecimals(),
    full: vine.boolean().optional(),
  }),
)
