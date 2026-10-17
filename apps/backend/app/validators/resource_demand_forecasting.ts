import vine from '@vinejs/vine'
import {
  FORECAST_GRANULARITY_VALUES,
  FORECAST_CONFIDENCE_BAND_VALUES,
  FORECAST_METHOD_VALUES,
  FORECAST_SORT_KEY_VALUES,
} from '@aiproj/types'
import type {
  ResourceDemandForecastQuery,
  ForecastGranularity,
  ForecastConfidenceBand,
  ForecastMethod,
  ForecastSortKey,
  ForecastLoadStatus,
} from '@aiproj/types'

/**
 * 资源需求预测验证器（v3-resource-demand-forecasting §4.2）。
 *
 * 所有参数在执行预测聚合前必须被白名单与上限约束；
 * 非法参数返回 VALIDATION_ERROR，绝不退化成无界全组织扫描。
 */

const granularityEnum = () => vine.enum(FORECAST_GRANULARITY_VALUES)
const confidenceBandEnum = () => vine.enum(FORECAST_CONFIDENCE_BAND_VALUES)
const methodEnum = () => vine.enum(FORECAST_METHOD_VALUES)
const sortKeyEnum = () => vine.enum(FORECAST_SORT_KEY_VALUES)

// ─── 共用基础 schema ──────────────────────────────────────────────────────

const baseQuerySchema = vine.object({
  startDate: vine.string().trim(),
  endDate: vine.string().trim(),
  granularity: granularityEnum(),
  projectIds: vine.string().trim().optional(),
  roles: vine.string().trim().optional(),
  skills: vine.string().trim().optional(),
  departments: vine.string().trim().optional(),
  loadStatuses: vine.string().trim().optional(), // comma-separated load statuses, validated by normalizeForecastQuery
  confidenceThreshold: confidenceBandEnum().optional(),
  method: methodEnum().optional(),
  topN: vine.number().positive().max(500).optional(),
  sort: sortKeyEnum().optional(),
  sortDir: vine.enum(['asc', 'desc']).optional(),
  page: vine.number().positive().optional(),
  perPage: vine.number().positive().max(200).optional(),
  freshnessThresholdSeconds: vine.number().positive().optional(),
})

// ─── 各端点 validator ─────────────────────────────────────────────────────

/** 预测摘要查询 */
export const forecastSummaryValidator = vine.compile(baseQuerySchema)

/** 需求曲线查询 */
export const forecastDemandCurvesValidator = vine.compile(baseQuerySchema)

/** 缺口分析查询 */
export const forecastGapAnalysisValidator = vine.compile(baseQuerySchema)

/** 项目驱动查询 */
export const forecastProjectDriversValidator = vine.compile(baseQuerySchema)

/** 技能驱动查询 */
export const forecastSkillDriversValidator = vine.compile(baseQuerySchema)

/** 趋势基线查询 */
export const forecastTrendBaselineValidator = vine.compile(
  vine.object({
    startDate: vine.string().trim(),
    endDate: vine.string().trim(),
    granularity: granularityEnum(),
    role: vine.string().trim().optional(),
    skill: vine.string().trim().optional(),
    method: methodEnum().optional(),
  }),
)

/** 下钻查询 */
export const forecastDrillDownValidator = vine.compile(
  vine.object({
    targetType: vine.string().trim(),
    targetId: vine.string().trim(),
    gapType: vine.string().trim().optional(),
    role: vine.string().trim().optional(),
    skill: vine.string().trim().optional(),
    projectId: vine.string().trim().optional(),
    bucketStart: vine.string().trim().optional(),
    bucketEnd: vine.string().trim().optional(),
  }),
)

/** AI 咨询请求 */
export const forecastAiAdvisoryValidator = vine.compile(
  vine.object({
    // AI advisory 无额外参数，由 query params 传入
    startDate: vine.string().trim().optional(),
    endDate: vine.string().trim().optional(),
    granularity: granularityEnum().optional(),
  }),
)

// ─── 参数解析与归一化 ────────────────────────────────────────────────────

/**
 * 将逗号分隔的字符串参数解析为数组。
 */
export function parseCommaSeparatedParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 将 comma-separated 数字字符串解析为数字数组。
 */
export function parseNumericParam(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const result = value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return result.length > 0 ? result : undefined
}

/**
 * 将验证后的参数归一化为预测查询对象。
 * 应用默认值、解析逗号分隔数组、规范化粒度等。
 */
export function normalizeForecastQuery(
  validated: Record<string, unknown>,
): ResourceDemandForecastQuery {
  const startDate = (validated.startDate as string) ?? ''
  const endDate = (validated.endDate as string) ?? ''
  const granularity = (validated.granularity as ForecastGranularity) ?? 'week'

  return {
    startDate,
    endDate,
    granularity,
    projectIds: parseCommaSeparatedParam(validated.projectIds),
    roles: parseCommaSeparatedParam(validated.roles),
    skills: parseCommaSeparatedParam(validated.skills),
    departments: parseCommaSeparatedParam(validated.departments),
    loadStatuses: parseCommaSeparatedParam(validated.loadStatuses) as
      ForecastLoadStatus[] | undefined,
    confidenceThreshold: (validated.confidenceThreshold as ForecastConfidenceBand) ?? undefined,
    method: (validated.method as ForecastMethod) ?? 'deterministic_bucket',
    topN: (validated.topN as number) ?? undefined,
    sort: (validated.sort as ForecastSortKey) ?? 'gap',
    sortDir: (validated.sortDir as 'asc' | 'desc') ?? 'desc',
    page: (validated.page as number) ?? 1,
    perPage: (validated.perPage as number) ?? 50,
    freshnessThresholdSeconds: (validated.freshnessThresholdSeconds as number) ?? undefined,
  }
}
