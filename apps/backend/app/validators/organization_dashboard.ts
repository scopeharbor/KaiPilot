import vine from '@vinejs/vine'
import {
  ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEY_VALUES,
  ORGANIZATION_DASHBOARD_HEALTH_FILTERS,
  ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT,
  ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT,
  ORGANIZATION_DASHBOARD_MAX_DUE_SOON_DAYS,
  ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES,
  ORGANIZATION_DASHBOARD_MAX_SEARCH_LENGTH,
  ORGANIZATION_DASHBOARD_PROJECT_STATUS_FILTERS,
  ORGANIZATION_DASHBOARD_SECTION_VALUES,
} from '@aiproj/types'

/**
 * 组织 Dashboard 查询验证器（v3-organization-dashboard §3.1）。
 *
 * 红线：所有 section / sort / filter / limit / freshness 参数必须在执行组织级查询**之前**
 * 被白名单与上限约束；非法参数返回 `VALIDATION_ERROR`，绝不退化成无界全组织扫描。
 */

const section = () => vine.enum(ORGANIZATION_DASHBOARD_SECTION_VALUES)
const attentionSort = () => vine.enum(ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEY_VALUES)
const statusFilter = () => vine.enum(ORGANIZATION_DASHBOARD_PROJECT_STATUS_FILTERS)
const healthFilter = () => vine.enum(ORGANIZATION_DASHBOARD_HEALTH_FILTERS)

/** 路由参数：organizationId 必须是正整数。 */
export const organizationDashboardParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 查询参数白名单。 */
export const organizationDashboardQueryValidator = vine.compile(
  vine.object({
    sections: vine.array(section()).optional(),
    attentionLimit: vine
      .number()
      .positive()
      .max(ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT)
      .optional(),
    activityLimit: vine
      .number()
      .positive()
      .max(ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT)
      .optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
    dueSoonDays: vine.number().positive().max(ORGANIZATION_DASHBOARD_MAX_DUE_SOON_DAYS).optional(),
    attentionSort: attentionSort().optional(),
    attentionOrder: vine.enum(['asc', 'desc']).optional(),
    filterStatus: statusFilter().optional(),
    filterHealth: healthFilter().optional(),
    search: vine.string().trim().maxLength(ORGANIZATION_DASHBOARD_MAX_SEARCH_LENGTH).optional(),
  }),
)

/**
 * 归一化 query string 中的 `sections` 参数。
 *
 * 支持 `?sections=kpi,activity`（逗号分隔）与 `?sections[]=kpi&sections[]=activity`（数组），
 * 空串/空数组按「未指定」处理，交由验证器与共享归一化函数补默认全 section。
 * 不在此处过滤未知值——未知 section 必须走验证器返回 `VALIDATION_ERROR`，而不是被静默丢弃。
 */
export function parseSectionsParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw)
    ? raw.map((item) => String(item))
    : String(raw)
        .split(',')
        .map((item) => item.trim())
  const cleaned = list.filter((item) => item.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}
