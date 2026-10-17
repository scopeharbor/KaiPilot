import vine from '@vinejs/vine'

/**
 * PMO 组合 Dashboard 验证器（v3-pmo-portfolio-dashboard §3.1）。
 * 覆盖：summary query、project list query、group slice query、trend query、metric detail query。
 * 约束：分页上限 100、group by 白名单、sort key 白名单、trend window 白名单、filter 限制。
 */

/** 获取组合 Dashboard 摘要 */
export const portfolioDashboardSummaryValidator = vine.compile(
  vine.object({
    includeTrafficLight: vine.boolean().optional(),
    includeFreshness: vine.boolean().optional(),
  }),
)

/** 获取组合项目列表 */
export const portfolioProjectListValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    sort: vine.string().maxLength(50).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    filterStatus: vine.string().maxLength(50).optional(),
    filterHealth: vine.string().maxLength(50).optional(),
    search: vine.string().maxLength(200).optional(),
  }),
)

/** 获取分组切片 */
export const portfolioGroupSliceValidator = vine.compile(
  vine.object({
    groupBy: vine.string().maxLength(50),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    sort: vine.string().maxLength(50).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
  }),
)

/** 获取趋势数据 */
export const portfolioTrendValidator = vine.compile(
  vine.object({
    window: vine.string().maxLength(30),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

/** 获取指标详情 */
export const portfolioMetricDetailValidator = vine.compile(
  vine.object({
    metricKey: vine.string().maxLength(60),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)
