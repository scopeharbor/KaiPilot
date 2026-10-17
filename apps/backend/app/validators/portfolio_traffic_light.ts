import vine from '@vinejs/vine'

/**
 * PMO 组合交通灯验证器（v3-pmo-portfolio-traffic-light §4.5）。
 */

/** 交通灯列表查询 */
export const portfolioTrafficLightListValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    sort: vine.string().maxLength(50).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    filterStatus: vine.string().maxLength(30).optional(),
    filterProjectStatus: vine.string().maxLength(50).optional(),
    filterStale: vine.boolean().optional(),
    filterWarningCode: vine.string().maxLength(50).optional(),
    filterReviewState: vine.string().maxLength(30).optional(),
  }),
)

/** 复核标记创建/更新 */
export const portfolioTrafficLightReviewValidator = vine.compile(
  vine.object({
    reviewState: vine.string().maxLength(30),
    note: vine.string().maxLength(2000).optional(),
  }),
)
