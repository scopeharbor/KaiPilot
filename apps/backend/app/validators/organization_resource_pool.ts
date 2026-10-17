import vine from '@vinejs/vine'
import {
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES,
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES,
  ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES,
  ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE,
  ORGANIZATION_RESOURCE_POOL_MAX_SEARCH_LENGTH,
  ORGANIZATION_RESOURCE_POOL_MAX_TOP_N,
  ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES,
  ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES,
  ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES,
} from '@aiproj/types'

/**
 * 组织资源池查询验证器（v3-organization-resource-pool §3.1）。
 *
 * 所有参数在执行组织级聚合查询之前必须被白名单与上限约束；
 * 非法参数返回 VALIDATION_ERROR，绝不退化成无界全组织扫描。
 */

const viewMode = () => vine.enum(ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES)
const sortKey = () => vine.enum(ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES)
const loadStatus = () => vine.enum(ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES)
const conflictSeverity = () => vine.enum(ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const organizationResourcePoolParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 资源池 summary 查询——与 catalogue 共用，因为 catalogue 是 summary 的子集。 */
export const organizationResourcePoolSummaryValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 资源列表查询。 */
export const organizationResourcePoolResourcesValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    view: viewMode().optional(),
    resourceType: vine.enum(Object.values(ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES)).optional(),
    role: vine.string().trim().optional(),
    skill: vine.string().trim().optional(),
    department: vine.string().trim().optional(),
    loadStatus: loadStatus().optional(),
    conflictSeverity: conflictSeverity().optional(),
    projectIds: vine.string().trim().optional(), // comma-separated
    search: vine.string().trim().maxLength(ORGANIZATION_RESOURCE_POOL_MAX_SEARCH_LENGTH).optional(),
    sort: sortKey().optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE).optional(),
    topN: vine.number().positive().max(ORGANIZATION_RESOURCE_POOL_MAX_TOP_N).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 容量矩阵查询。 */
export const organizationResourcePoolCapacityValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    resourceType: vine.enum(Object.values(ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES)).optional(),
    role: vine.string().trim().optional(),
    skill: vine.string().trim().optional(),
    loadStatus: loadStatus().optional(),
    projectIds: vine.string().trim().optional(),
    topN: vine.number().positive().max(ORGANIZATION_RESOURCE_POOL_MAX_TOP_N).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 技能覆盖查询。 */
export const organizationResourcePoolSkillsValidator = vine.compile(
  vine.object({
    role: vine.string().trim().optional(),
    skill: vine.string().trim().optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 冲突列表查询。 */
export const organizationResourcePoolConflictsValidator = vine.compile(
  vine.object({
    from: vine.string().optional(),
    to: vine.string().optional(),
    conflictSeverity: conflictSeverity().optional(),
    resourceType: vine.enum(Object.values(ORGANIZATION_RESOURCE_POOL_RESOURCE_TYPES)).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 需求缺口查询。 */
export const organizationResourcePoolDemandGapsValidator = vine.compile(
  vine.object({
    role: vine.string().trim().optional(),
    skill: vine.string().trim().optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE).optional(),
    freshnessWindowMinutes: vine
      .number()
      .positive()
      .max(ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES)
      .optional(),
  }),
)

/** 下钻查询——需二次授权，目标类型必须白名单。 */
export const organizationResourcePoolDrillDownValidator = vine.compile(
  vine.object({
    kind: vine.enum(['project', 'resource', 'task', 'skill', 'conflict', 'demand_gap']),
    targetId: vine.number().positive().optional(),
    resourceId: vine.number().positive().optional(),
    projectId: vine.number().positive().optional(),
    taskId: vine.number().positive().optional(),
    skill: vine.string().trim().optional(),
    conflictId: vine.string().trim().optional(),
    gapId: vine.string().trim().optional(),
  }),
)

/**
 * 解析逗号分隔的 projectIds 查询参数。
 */
export function parseProjectIdsParam(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const str = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw)
  const ids = str
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return ids.length > 0 ? ids : undefined
}
