/**
 * PMO 优先级评分模型后端验证器（v3-pmo-priority-scoring-model §3.1）
 *
 * 所有组织级评分参数必须在运行查询前被白名单和上限约束。
 * 不支持的过滤器/排序/分组/等级/版本统一返回 VALIDATION_ERROR。
 */
import vine from '@vinejs/vine'
import {
  PRIORITY_LEVELS,
  SUPPORTED_PRIORITY_SORT_KEYS,
  SUPPORTED_PRIORITY_GROUP_KEYS,
  SCORE_VERSIONS,
  MAX_PRIORITY_PAGE_SIZE,
} from '@aiproj/types'

const priorityLevels = () => vine.array(vine.enum(PRIORITY_LEVELS)).optional()
const sortKey = () => vine.enum(SUPPORTED_PRIORITY_SORT_KEYS)
const groupKey = () => vine.enum(SUPPORTED_PRIORITY_GROUP_KEYS)
const scoreVersion = () => vine.enum(SCORE_VERSIONS)

/**
 * PMO 优先级评分摘要查询验证器。
 */
export const pmoPriorityScoringSummaryValidator = vine.compile(
  vine.object({
    scoreVersion: scoreVersion().optional(),
  }),
)

/**
 * PMO 优先级评分项目列表查询验证器。
 * 拒绝无界分页和不支持的排序/分组/过滤/版本。
 */
export const pmoPriorityScoringListValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(MAX_PRIORITY_PAGE_SIZE).optional(),
    sort: sortKey().optional(),
    priorityLevels: priorityLevels(),
    scoreVersion: scoreVersion().optional(),
    groupBy: groupKey().optional(),
  }),
)

/**
 * PMO 优先级评分分组切片查询验证器。
 */
export const pmoPriorityScoringGroupsValidator = vine.compile(
  vine.object({
    groupBy: groupKey(),
    scoreVersion: scoreVersion().optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(MAX_PRIORITY_PAGE_SIZE).optional(),
  }),
)

/**
 * PMO 优先级评分权重版本查询验证器。
 */
export const pmoPriorityScoringWeightsValidator = vine.compile(
  vine.object({
    scoreVersion: scoreVersion().optional(),
  }),
)

/**
 * PMO 优先级评分项目详情查询验证器。
 */
export const pmoPriorityScoringDetailValidator = vine.compile(
  vine.object({
    scoreVersion: scoreVersion().optional(),
    includeGroupSlices: vine.boolean().optional(),
  }),
)
