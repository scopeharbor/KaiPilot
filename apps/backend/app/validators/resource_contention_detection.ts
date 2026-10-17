import vine from '@vinejs/vine'
import {
  RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES,
  RESOURCE_CONTENTION_MAX_PER_PAGE,
  RESOURCE_CONTENTION_MAX_TOP_N,
  RESOURCE_CONTENTION_SEVERITY_VALUES,
  RESOURCE_CONTENTION_REASON_CODE_VALUES,
  RESOURCE_CONTENTION_SORT_KEY_VALUES,
} from '@aiproj/types'

/**
 * 资源争用检测查询验证器（v3-resource-contention-detection §3.1）。
 *
 * 有界日期窗口、分页、top-N、排序、聚合以及白名单筛选验证。
 * 所有参数在执行组织级查询前必须通过白名单与上限约束；
 * 非法参数返回 VALIDATION_ERROR，不得退化为无界组织级扫描。
 */

const severity = () => vine.enum(RESOURCE_CONTENTION_SEVERITY_VALUES)
const reasonCode = () => vine.enum(RESOURCE_CONTENTION_REASON_CODE_VALUES)
const sortKey = () => vine.enum(RESOURCE_CONTENTION_SORT_KEY_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const resourceContentionParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 路径参数：contentionId 必须是字符串。 */
export const resourceContentionDetailParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    contentionId: vine.string().trim(),
  }),
)

/** 争用摘要查询。 */
export const resourceContentionSummaryValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    severity: severity().optional(),
    reasonCode: reasonCode().optional(),
    projectIds: vine.string().trim().optional(), // comma-separated
    resourceIds: vine.string().trim().optional(), // comma-separated
    skillIds: vine.string().trim().optional(), // comma-separated
    aggregation: vine.enum(['none', 'by_resource', 'by_project', 'by_skill', 'by_date']).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 争用列表查询。 */
export const resourceContentionItemsValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    severity: severity().optional(),
    reasonCode: reasonCode().optional(),
    projectIds: vine.string().trim().optional(),
    resourceIds: vine.string().trim().optional(),
    skillIds: vine.string().trim().optional(),
    aggregation: vine.enum(['none', 'by_resource', 'by_project', 'by_skill', 'by_date']).optional(),
    sort: sortKey().optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(RESOURCE_CONTENTION_MAX_PER_PAGE).optional(),
    topN: vine.number().positive().max(RESOURCE_CONTENTION_MAX_TOP_N).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 争用矩阵查询。 */
export const resourceContentionMatrixValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    severity: severity().optional(),
    reasonCode: reasonCode().optional(),
    projectIds: vine.string().trim().optional(),
    resourceIds: vine.string().trim().optional(),
    topN: vine.number().positive().max(RESOURCE_CONTENTION_MAX_TOP_N).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(RESOURCE_CONTENTION_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 争用详情查询。 */
export const resourceContentionDetailValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
  }),
)

/** 建议预览查询。 */
export const resourceContentionSuggestionValidator = vine.compile(
  vine.object({
    kind: vine.enum(['rule', 'ai']).optional(),
  }),
)

/**
 * 解析逗号分隔的 ID 查询参数（通用函数）。
 */
export function parseNumericListParam(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const str = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw)
  const ids = str
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return ids.length > 0 ? ids : undefined
}
