import vine from '@vinejs/vine'
import {
  BI_RISK_HEATMAP_METRIC_KEY_VALUES,
  BI_RISK_HEATMAP_WINDOW_VALUES,
  BI_RISK_HEATMAP_DIMENSION_KEY_VALUES,
  BI_RISK_HEATMAP_RISK_LEVEL_VALUES,
  BI_RISK_HEATMAP_COMPARE_MODE_VALUES,
  BI_RISK_HEATMAP_SORT_KEY_VALUES,
  BI_RISK_HEATMAP_MAX_PER_PAGE,
} from '@aiproj/types'

/**
 * BI 风险热力图查询验证器（v3-bi-risk-heatmap §3.2）。
 */

const metricKey = () => vine.enum(BI_RISK_HEATMAP_METRIC_KEY_VALUES)
const window = () => vine.enum(BI_RISK_HEATMAP_WINDOW_VALUES)
const dimension = () => vine.enum(BI_RISK_HEATMAP_DIMENSION_KEY_VALUES)
const riskLevel = () => vine.enum(BI_RISK_HEATMAP_RISK_LEVEL_VALUES)
const compareMode = () => vine.enum(BI_RISK_HEATMAP_COMPARE_MODE_VALUES)
const sortKey = () => vine.enum(BI_RISK_HEATMAP_SORT_KEY_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const biRiskHeatmapParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 查询参数白名单。 */
export const biRiskHeatmapQueryValidator = vine.compile(
  vine.object({
    metricKey: metricKey(),
    window: window().optional(),
    rowDimension: dimension().optional(),
    columnDimension: dimension().optional(),
    projectIds: vine.array(vine.number().positive()).optional(),
    departments: vine.array(vine.string().trim()).optional(),
    portfolioGroups: vine.array(vine.string().trim()).optional(),
    riskCategories: vine.array(vine.string().trim()).optional(),
    riskLevels: vine.array(riskLevel()).optional(),
    riskStatuses: vine.array(vine.string().trim()).optional(),
    assigneeIds: vine.array(vine.number().positive()).optional(),
    compareWith: compareMode().optional(),
    sort: sortKey().optional(),
    sortDir: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(BI_RISK_HEATMAP_MAX_PER_PAGE).optional(),
  }),
)

/**
 * 解析逗号分隔或数组形式的 query string 参数。
 */
export function parseCsvParam(raw: unknown): string[] | undefined {
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
 * 将 query string 中的 CSV 参数展开为数组，供验证器消费。
 */
export function normalizeBiRiskHeatmapQuery(qs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...qs }
  for (const key of [
    'departments',
    'portfolioGroups',
    'riskCategories',
    'riskLevels',
    'riskStatuses',
  ]) {
    const val = parseCsvParam(qs[key])
    if (val !== undefined) out[key] = val
  }
  for (const key of ['projectIds', 'assigneeIds']) {
    const val = parseCsvParam(qs[key])
    if (val !== undefined) out[key] = val.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  }
  if (qs['page'] !== undefined) out['page'] = Number(qs['page'])
  if (qs['perPage'] !== undefined) out['perPage'] = Number(qs['perPage'])
  return out
}
