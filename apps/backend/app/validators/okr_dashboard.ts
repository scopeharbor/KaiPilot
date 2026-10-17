import vine from '@vinejs/vine'
import {
  OKR_DASHBOARD_ATTENTION_SORT_KEY_VALUES,
  OKR_DASHBOARD_INCLUDE_VALUES,
  OKR_DASHBOARD_MAX_ATTENTION_LIMIT,
  OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS,
  OKR_DASHBOARD_MAX_SEARCH_LENGTH,
  OKR_DASHBOARD_MAX_STALE_MINUTES,
  OKR_DASHBOARD_SECTION_VALUES,
  OKR_SCOPE_VALUES,
  OKR_STATUS_VALUES,
} from '@aiproj/types'

/**
 * OKR Dashboard 查询验证器（v3-okr-dashboard §3.1）。
 *
 * 红线：section/include/sort/limit/scope/status/freshness/date window/attention 参数
 * 必须在执行组织级查询**之前**被白名单与上限约束；非法参数一律 `VALIDATION_ERROR`，
 * 绝不退化成无界扫描或跨组织读取。
 */

const section = () => vine.enum(OKR_DASHBOARD_SECTION_VALUES)
const include = () => vine.enum(OKR_DASHBOARD_INCLUDE_VALUES)
const attentionSort = () => vine.enum(OKR_DASHBOARD_ATTENTION_SORT_KEY_VALUES)
const scope = () => vine.enum(OKR_SCOPE_VALUES)
const status = () => vine.enum(OKR_STATUS_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const okrDashboardParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 查询参数白名单。 */
export const okrDashboardQueryValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().optional(),
    ownerId: vine.number().positive().optional(),
    scope: vine.array(scope()).optional(),
    status: vine.array(status()).optional(),
    sections: vine.array(section()).optional(),
    include: vine.array(include()).optional(),
    attentionLimit: vine.number().positive().max(OKR_DASHBOARD_MAX_ATTENTION_LIMIT).optional(),
    attentionSort: attentionSort().optional(),
    attentionOrder: vine.enum(['asc', 'desc']).optional(),
    staleThresholdMinutes: vine.number().positive().max(OKR_DASHBOARD_MAX_STALE_MINUTES).optional(),
    dateFrom: vine.string().trim().optional(),
    dateTo: vine.string().trim().optional(),
    search: vine.string().trim().maxLength(OKR_DASHBOARD_MAX_SEARCH_LENGTH).optional(),
  }),
)

export const OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS_EXPORT = OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS

/**
 * 归一化 query string 中的 `sections` / `include` / `scope` / `status`。
 *
 * 支持 `?sections=kpi,attention`（逗号分隔）与 `?sections[]=kpi&sections[]=attention`（数组）。
 * 空串/空数组按「未指定」处理；不静默过滤未知值——非法值必须走验证器返回 VALIDATION_ERROR。
 */
export function parseOkrDashboardListParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw)
    ? raw.map((item) => String(item))
    : String(raw)
        .split(',')
        .map((item) => item.trim())
  const cleaned = list.filter((item) => item.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * 校验 dateFrom / dateTo 组成的窗口不超过上限。返回错误消息（用于统一错误响应），
 * 或 null 表示通过。dateFrom > dateTo 视为非法。
 */
export function validateOkrDashboardDateWindow(dateFrom?: string, dateTo?: string): string | null {
  if (!dateFrom && !dateTo) return null
  if (!dateFrom || !dateTo) return null
  const from = new Date(dateFrom).getTime()
  const to = new Date(dateTo).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '日期格式非法'
  if (to < from) return 'dateTo 必须晚于 dateFrom'
  const days = (to - from) / (1000 * 60 * 60 * 24)
  if (days > OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS) {
    return `日期窗口不得超过 ${OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS} 天`
  }
  return null
}
