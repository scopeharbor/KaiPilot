import vine from '@vinejs/vine'

/**
 * 图表馆度量/聚合查询校验器（v3-chart-gallery-data-foundation）。
 *
 * 全部为 GET 只读聚合端点（design D5）；非法枚举/范围在路由层直接 422。
 * 聚合正确性、跨租户 404 由各度量服务判定。
 */

const isoDateOptional = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()

/** EVM 指标卡 / S 曲线：可选 asOfDate（默认今天）。 */
export const evmQueryValidator = vine.compile(
  vine.object({
    asOfDate: isoDateOptional(),
  }),
)

/** 燃尽/燃起图：granularity day|week、metric task|hour、可选起止日期。 */
export const burndownQueryValidator = vine.compile(
  vine.object({
    granularity: vine.enum(['day', 'week'] as const).optional(),
    metric: vine.enum(['task', 'hour'] as const).optional(),
    startDate: isoDateOptional(),
    endDate: isoDateOptional(),
  }),
)

/** SPC 控制图：metric cycle_time|lead_time（默认 cycle_time）、limit 采样上限。 */
export const spcQueryValidator = vine.compile(
  vine.object({
    metric: vine.enum(['cycle_time', 'lead_time'] as const).optional(),
    limit: vine.number().withoutDecimals().range([1, 1000]).optional(),
  }),
)

/** 帕累托二八分析：dimension 四选一（默认 issue_type）。 */
export const paretoQueryValidator = vine.compile(
  vine.object({
    dimension: vine
      .enum(['issue_type', 'issue_severity', 'risk_category', 'change_type'] as const)
      .optional(),
  }),
)
