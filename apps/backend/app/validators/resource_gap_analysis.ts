import vine from '@vinejs/vine'
import {
  RESOURCE_GAP_METRIC_VALUES,
  RESOURCE_GAP_DIMENSION_VALUES,
  RESOURCE_GAP_SEVERITY_VALUES,
  RESOURCE_GAP_MAX_PER_PAGE,
  RESOURCE_GAP_MAX_TOP_N,
  RESOURCE_GAP_MAX_REASON_TOP_N,
} from '@aiproj/types'

/**
 * 资源缺口分析查询验证器（v3-resource-gap-analysis §3.1）。
 *
 * 所有参数在执行组织级缺口聚合之前必须被白名单与上限约束；
 * 非法参数返回 VALIDATION_ERROR，绝不退化成无界全组织扫描。
 */

const gapMetric = () => vine.enum(RESOURCE_GAP_METRIC_VALUES)
const gapDimension = () => vine.enum(RESOURCE_GAP_DIMENSION_VALUES)
const gapSeverity = () => vine.enum(RESOURCE_GAP_SEVERITY_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const resourceGapParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 缺口分析 summary 查询。 */
export const resourceGapSummaryValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    metrics: vine.array(gapMetric()).optional(),
    severity: gapSeverity().optional(),
    dimension: gapDimension().optional(),
    projectIds: vine.string().trim().optional(), // comma-separated
    skillKeys: vine.string().trim().optional(), // comma-separated
    roles: vine.string().trim().optional(), // comma-separated
    portfolioIds: vine.string().trim().optional(), // comma-separated
    timeBucketGranularity: vine.enum(['day', 'iso_week', 'month']).optional(),
    topN: vine.number().positive().max(RESOURCE_GAP_MAX_TOP_N).optional(),
    search: vine.string().trim().maxLength(200).optional(),
    sort: vine.string().trim().optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(RESOURCE_GAP_MAX_PER_PAGE).optional(),
  }),
)

/** 缺口分析 by-role / by-skill / by-timebucket / by-project / by-portfolio 查询。 */
export const resourceGapDimensionValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    metrics: vine.array(gapMetric()).optional(),
    severity: gapSeverity().optional(),
    projectIds: vine.string().trim().optional(),
    skillKeys: vine.string().trim().optional(),
    roles: vine.string().trim().optional(),
    portfolioIds: vine.string().trim().optional(),
    timeBucketGranularity: vine.enum(['day', 'iso_week', 'month']).optional(),
    topN: vine.number().positive().max(RESOURCE_GAP_MAX_TOP_N).optional(),
    reasonTopN: vine.number().positive().max(RESOURCE_GAP_MAX_REASON_TOP_N).optional(),
    search: vine.string().trim().maxLength(200).optional(),
    sort: vine.string().trim().optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(RESOURCE_GAP_MAX_PER_PAGE).optional(),
  }),
)

/** 缺口分析 explanation 查询。 */
export const resourceGapExplanationValidator = vine.compile(
  vine.object({
    gapId: vine.string().trim(),
    includeAi: vine.boolean().optional(),
  }),
)

/** 缺口分析 drill-down 查询。 */
export const resourceGapDrillDownValidator = vine.compile(
  vine.object({
    gapId: vine.string().trim(),
    sourceCapability: vine
      .enum([
        'resource-contention-detection',
        'resource-demand-forecasting',
        'resource-registry-and-allocation',
      ] as const)
      .optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(RESOURCE_GAP_MAX_PER_PAGE).optional(),
  }),
)

/** 辅助：解析逗号分隔的查询参数 */
export function parseCommaParam(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return undefined
}

/** 辅助：解析逗号分隔的数字 ID 参数 */
export function parseNumberIdsParam(value: unknown): number[] | undefined {
  const parts = parseCommaParam(value)
  if (!parts) return undefined
  const ids = parts.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  return ids.length > 0 ? ids : undefined
}
