import vine from '@vinejs/vine'
import {
  BI_TREND_METRIC_KEY_VALUES,
  BI_TREND_GRAIN_VALUES,
  BI_TREND_WINDOW_VALUES,
  BI_TREND_DIMENSION_KEY_VALUES,
  BI_TREND_COMPARE_MODE_VALUES,
  BI_TREND_SORT_KEY_VALUES,
  BI_TREND_MAX_PER_PAGE,
} from '@aiproj/types'

/**
 * BI 趋势分析查询验证器（v3-bi-trend-analysis §3.2）。
 */

const metricKey = () => vine.enum(BI_TREND_METRIC_KEY_VALUES)
const grain = () => vine.enum(BI_TREND_GRAIN_VALUES)
const window = () => vine.enum(BI_TREND_WINDOW_VALUES)
const dimension = () => vine.enum(BI_TREND_DIMENSION_KEY_VALUES)
const compareMode = () => vine.enum(BI_TREND_COMPARE_MODE_VALUES)
const sortKey = () => vine.enum(BI_TREND_SORT_KEY_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const biTrendAnalysisParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 查询参数白名单。 */
export const biTrendAnalysisQueryValidator = vine.compile(
  vine.object({
    metricKeys: vine.array(metricKey()).optional(),
    window: window().optional(),
    grain: grain().optional(),
    dimensions: vine.array(dimension()).optional(),
    projectIds: vine.array(vine.number().positive()).optional(),
    departments: vine.array(vine.string().trim()).optional(),
    roles: vine.array(vine.string().trim()).optional(),
    skills: vine.array(vine.string().trim()).optional(),
    portfolioGroups: vine.array(vine.string().trim()).optional(),
    riskLevels: vine.array(vine.string().trim()).optional(),
    compareWith: compareMode().optional(),
    includeAnomalies: vine.boolean().optional(),
    includeForecast: vine.boolean().optional(),
    sort: sortKey().optional(),
    sortDir: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(BI_TREND_MAX_PER_PAGE).optional(),
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
export function normalizeBiTrendQuery(qs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...qs }
  for (const key of [
    'metricKeys',
    'dimensions',
    'departments',
    'roles',
    'skills',
    'portfolioGroups',
    'riskLevels',
  ]) {
    const val = parseCsvParam(qs[key])
    if (val !== undefined) out[key] = val
  }
  for (const key of ['projectIds']) {
    const val = parseCsvParam(qs[key])
    if (val !== undefined) out[key] = val.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  }
  for (const key of ['includeAnomalies', 'includeForecast']) {
    if (qs[key] === 'true') out[key] = true
    else if (qs[key] === 'false') out[key] = false
  }
  if (qs['page'] !== undefined) out['page'] = Number(qs['page'])
  if (qs['perPage'] !== undefined) out['perPage'] = Number(qs['perPage'])
  return out
}
