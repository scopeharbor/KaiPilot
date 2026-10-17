import vine from '@vinejs/vine'
import {
  COCKPIT_INCLUDE_VALUES,
  COCKPIT_MAX_ATTENTION_LIMIT,
  COCKPIT_MAX_FRESHNESS_MINUTES,
  COCKPIT_SORT_KEY_VALUES,
  OKR_SCOPE_VALUES,
  OKR_STATUS_VALUES,
} from '@aiproj/types'

/**
 * 战略执行驾驶舱查询验证器（v3-strategy-execution-cockpit §4.2）。
 *
 * 红线：所有 cycle/scope/status/theme/include/sort/window/limit 参数必须在执行
 * 聚合之前被白名单与上限约束；非法参数返回 VALIDATION_ERROR，绝不退化为无界扫描。
 */

/** 路由参数：organizationId 必须是正整数。 */
export const strategyExecutionCockpitParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 查询参数白名单。 */
export const strategyExecutionCockpitQueryValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().optional(),
    scope: vine.array(vine.enum(OKR_SCOPE_VALUES)).optional(),
    ownerId: vine.array(vine.number().positive()).optional(),
    status: vine.array(vine.enum(OKR_STATUS_VALUES)).optional(),
    theme: vine.array(vine.string().trim().maxLength(80)).optional(),
    include: vine.array(vine.enum(COCKPIT_INCLUDE_VALUES)).optional(),
    freshnessWindowMinutes: vine.number().positive().max(COCKPIT_MAX_FRESHNESS_MINUTES).optional(),
    attentionLimit: vine.number().positive().max(COCKPIT_MAX_ATTENTION_LIMIT).optional(),
    sort: vine.enum(COCKPIT_SORT_KEY_VALUES).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    dateFrom: vine.date().optional(),
    dateTo: vine.date().optional(),
  }),
)

/**
 * 归一化 query string 中的数组参数（支持逗号分隔与数组两种形式）。
 * 空串/空数组按「未指定」处理，交由共享归一化函数补默认值。
 */
export function parseCockpitArrayParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw)
    ? raw.map((item) => String(item))
    : String(raw)
        .split(',')
        .map((item) => item.trim())
  const cleaned = list.filter((item) => item.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}
