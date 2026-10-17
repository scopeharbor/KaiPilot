import vine from '@vinejs/vine'

/**
 * 文件/附件校验器。
 */

/** 文件列表查询。 */
export const listFilesValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().range([1, 10000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
    parentId: vine.number().withoutDecimals().positive().nullable().optional(),
    search: vine.string().trim().maxLength(200).optional(),
    documentType: vine.enum(['folder', 'document', 'template']).optional(),
  }),
)

/** 附件列表查询。 */
export const listAttachmentsValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().range([1, 10000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
    entityType: vine.string().trim().maxLength(30).optional(),
    entityId: vine.number().withoutDecimals().positive().optional(),
    search: vine.string().trim().maxLength(200).optional(),
  }),
)

/** 创建文件夹/文档。 */
export const createDocumentValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    documentType: vine.enum(['folder', 'document', 'template']).optional(),
    parentId: vine.number().withoutDecimals().positive().nullable().optional(),
    content: vine.string().maxLength(100000).nullable().optional(),
  }),
)

/** 重命名文档。 */
export const renameDocumentValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
  }),
)

/** 移动文档。 */
export const moveDocumentValidator = vine.compile(
  vine.object({
    parentId: vine.number().withoutDecimals().positive().nullable(),
  }),
)

/** 创建附件（上传请求）。 */
export const createAttachmentValidator = vine.compile(
  vine.object({
    entityType: vine.string().trim().maxLength(30),
    entityId: vine.number().withoutDecimals().positive(),
  }),
)

/** 文档正文读取参数（路径参数校验）。 */
export const documentContentParamsValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive(),
    documentId: vine.number().withoutDecimals().positive(),
  }),
)
