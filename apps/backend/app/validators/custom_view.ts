import vine from '@vinejs/vine'

/**
 * 配置 JSON 字段白名单：只允许这些字段通过，防止恶意写入。
 * JSON 串大小上限 50KB（≈ 51200 字节 UTF-8）。
 */
const configWhitelistSchema = vine.object({
  schemaVersion: vine.number().withoutDecimals().range([1, 1]).optional(),
  baseViewType: vine
    .enum(['kanban', 'list', 'calendar', 'gantt', 'wbs', 'resource'] as const)
    .optional(),
  filters: vine
    .object({
      search: vine.string().trim().maxLength(500).optional(),
      statuses: vine.array(vine.string().trim()).optional(),
      priorities: vine.array(vine.string().trim()).optional(),
      assigneeIds: vine.array(vine.number().withoutDecimals().positive()).optional(),
      dateFrom: vine.string().trim().maxLength(50).optional(),
      dateTo: vine.string().trim().maxLength(50).optional(),
      roles: vine.array(vine.string().trim().maxLength(80)).optional(),
      skills: vine.array(vine.string().trim().maxLength(80)).optional(),
      loadStatuses: vine.array(vine.string().trim().maxLength(40)).optional(),
    })
    .optional(),
  sort: vine
    .array(
      vine.object({
        field: vine.string().trim().maxLength(64),
        direction: vine.enum(['asc', 'desc'] as const),
      }),
    )
    .optional(),
  display: vine.object({}).optional(),
  scope: vine.object({}).optional(),
  state: vine.object({}).optional(),
})

/**
 * 创建自定义视图 —— 参数校验。
 */
export const createCustomViewValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    baseViewType: vine.enum(['kanban', 'list', 'calendar', 'gantt', 'wbs', 'resource'] as const),
    visibility: vine.enum(['personal', 'shared'] as const),
    config: configWhitelistSchema,
  }),
)

/**
 * 更新自定义视图 —— 全部可选，允许只传要修改的字段。
 */
export const updateCustomViewValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100).optional(),
    config: configWhitelistSchema.optional(),
    visibility: vine.enum(['personal', 'shared'] as const).optional(),
  }),
)

/**
 * 排序更新 —— 视图 ID 数组。
 */
export const reorderCustomViewsValidator = vine.compile(
  vine.object({
    viewIds: vine.array(vine.number().withoutDecimals().positive()),
  }),
)

/**
 * 克隆共享视图 —— 可选重命名。
 */
export const cloneCustomViewValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100).optional(),
  }),
)
