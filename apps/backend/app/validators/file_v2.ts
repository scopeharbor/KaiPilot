import vine from '@vinejs/vine'

/**
 * V2 文件管理验证器（v2-file-management-upgrade）。
 *
 * 覆盖：版本上传、标签、搜索过滤、批量操作、恢复/永久删除和实体关联。
 */

/** 文件类型枚举。 */
const FileType = () => vine.enum(['attachment', 'document'])

/** 实体关联类型。 */
const LinkType = () => vine.enum(['related', 'reference', 'attachment'])

/** 标签颜色（十六进制）。 */
const TagColor = () =>
  vine
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional()

// === 版本 ===

/** 上传版本。 */
export const uploadVersionValidator = vine.compile(
  vine.object({
    changeNote: vine.string().maxLength(500).nullable().optional(),
  }),
)

/** 版本列表查询。 */
export const listVersionsValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().range([1, 10000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

// === 标签 ===

/** 创建标签。 */
export const createTagValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(50),
    color: TagColor(),
  }),
)

/** 更新标签。 */
export const updateTagValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(50).optional(),
    color: TagColor(),
  }),
)

/** 标签分配。 */
export const assignTagsValidator = vine.compile(
  vine.object({
    fileType: FileType(),
    fileId: vine.number().withoutDecimals().positive(),
    tagIds: vine.array(vine.number().withoutDecimals().positive()).minLength(1).maxLength(50),
  }),
)

/** 移除标签。 */
export const removeTagsValidator = vine.compile(
  vine.object({
    fileType: FileType(),
    fileId: vine.number().withoutDecimals().positive(),
    tagIds: vine.array(vine.number().withoutDecimals().positive()).minLength(1).maxLength(50),
  }),
)

// === 批量操作 ===

/** 批量操作项。 */
const batchItemSchema = vine.object({
  fileType: FileType(),
  fileId: vine.number().withoutDecimals().positive(),
})

/** 批量删除/恢复/永久删除。 */
export const batchActionValidator = vine.compile(
  vine.object({
    items: vine.array(batchItemSchema).minLength(1).maxLength(200),
  }),
)

/** 批量打标签。 */
export const batchTagValidator = vine.compile(
  vine.object({
    items: vine.array(batchItemSchema).minLength(1).maxLength(200),
    tagIds: vine.array(vine.number().withoutDecimals().positive()).minLength(1).maxLength(50),
  }),
)

// === 回收站 ===

/** 回收站列表查询。 */
export const listTrashValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().range([1, 10000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
    search: vine.string().maxLength(200).optional(),
    olderThan: vine.string().maxLength(30).optional(),
  }),
)

/** 删除到回收站。 */
export const trashValidator = vine.compile(
  vine.object({
    reason: vine.string().maxLength(500).nullable().optional(),
  }),
)

// === 搜索 ===

/** 搜索查询。 */
export const searchFilesValidator = vine.compile(
  vine.object({
    q: vine.string().trim().minLength(1).maxLength(200),
    fileType: FileType().optional(),
    mimeType: vine.string().maxLength(127).optional(),
    entityType: vine.string().maxLength(50).optional(),
    uploadedBy: vine.number().withoutDecimals().positive().optional(),
    dateFrom: vine.string().maxLength(30).optional(),
    dateTo: vine.string().maxLength(30).optional(),
    page: vine.number().withoutDecimals().range([1, 10000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

// === 实体关联 ===

const ENTITY_TYPE_WHITELIST = [
  'project',
  'task',
  'milestone',
  'risk',
  'document',
  'change_request',
  'comment',
  'report_version',
  'compiler_artifact',
] as const

/** 创建实体关联。 */
export const createLinkValidator = vine.compile(
  vine.object({
    fileType: FileType(),
    fileId: vine.number().withoutDecimals().positive(),
    entityType: vine.enum(ENTITY_TYPE_WHITELIST),
    entityId: vine.number().withoutDecimals().positive(),
    linkType: LinkType().optional(),
  }),
)
