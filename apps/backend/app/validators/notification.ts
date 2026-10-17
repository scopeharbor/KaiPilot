import vine from '@vinejs/vine'

/**
 * 通知列表 Validator（V2 通知中心扩展）：
 * - page / perPage：分页参数，上限 100
 * - status：筛选已读/未读/全部
 * - type：按通知类型筛选
 * - typeGroup：按类型组筛选（all/unread/mentions/assignments/approvals/system）
 * - severity：按严重级别筛选
 * - projectId：按项目筛选
 * - dateFrom / dateTo：时间范围筛选
 * - hidden：隐藏状态（include/exclude/only）
 */

// 分页上限
const MAX_PER_PAGE = 100

export const listNotificationsValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().positive().optional(),
    perPage: vine.number().withoutDecimals().positive().optional(),
    status: vine.enum(['read', 'unread', 'all']).optional(),
    type: vine.string().trim().optional(),
    severity: vine.enum(['info', 'warning', 'error', 'critical']).optional(),
    projectId: vine.number().withoutDecimals().positive().optional(),
    dateFrom: vine.string().trim().optional(),
    dateTo: vine.string().trim().optional(),
    typeGroup: vine
      .enum(['all', 'unread', 'mentions', 'assignments', 'approvals', 'system'])
      .optional(),
    hidden: vine.enum(['include', 'exclude', 'only']).optional(),
  }),
)

export const markReadParamsValidator = vine.compile(
  vine.object({
    id: vine.number().withoutDecimals().positive(),
  }),
)

/** 批量操作 Validator。 */
export const batchOperationValidator = vine.compile(
  vine.object({
    action: vine.enum(['mark_read', 'mark_unread', 'hide']),
    notificationIds: vine
      .array(vine.number().withoutDecimals().positive())
      .minLength(1)
      .maxLength(100) // 单次最多 100 条
      .optional(),
  }),
)

// 导出上限供 controller 使用
export { MAX_PER_PAGE }
