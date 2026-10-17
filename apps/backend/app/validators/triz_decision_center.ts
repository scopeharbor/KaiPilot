import vine from '@vinejs/vine'
import {
  TRIZ_DECISION_CENTER_QUEUE_STATUSES,
  TRIZ_DECISION_CENTER_SOURCE_KINDS,
  TRIZ_DECISION_CENTER_WARNING_CODES,
} from '@aiproj/types'

/**
 * v3-triz-decision-center —— TRIZ 决策中心校验器（tasks 4.2）。
 *
 * 所有校验器仅验证请求体的结构与类型，
 * 业务存在性与权限由 Controller/Service 层判定。
 */

/** 摘要校验：projectId 路径参数 */
export const trizDecisionCenterSummaryValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
  }),
)

/** 队列列表校验：分页、过滤、排序 */
export const trizDecisionCenterListValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    status: vine.enum(TRIZ_DECISION_CENTER_QUEUE_STATUSES).optional(),
    sourceKind: vine.enum(TRIZ_DECISION_CENTER_SOURCE_KINDS).optional(),
    warning: vine.enum(TRIZ_DECISION_CENTER_WARNING_CODES).optional(),
    priority: vine.number().min(1).max(10).optional(),
    search: vine.string().trim().maxLength(200).optional(),
    sort: vine.string().trim().maxLength(50).optional(),
  }),
)

/** 详情校验：itemId */
export const trizDecisionCenterDetailValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    itemId: vine.string().trim().minLength(1).maxLength(100),
  }),
)

/** Readiness 校验 */
export const trizDecisionCenterReadinessValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
  }),
)
