import vine from '@vinejs/vine'
import {
  PMO_RECOMMENDATION_SOURCES,
  PMO_AI_STATUSES,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_SEVERITIES,
  PMO_RECOMMENDATION_MAX_PER_PAGE,
  PMO_RECOMMENDATION_SORT_KEYS,
  PMO_REVIEW_ACTIONS,
  PMO_CONVERSION_TARGETS,
} from '@aiproj/types'

// 用于 vine enum 的白名单值
const SRC = PMO_RECOMMENDATION_SOURCES
const AI_ST = PMO_AI_STATUSES
const STS = RECOMMENDATION_STATUSES
const SEV = RECOMMENDATION_SEVERITIES
const SORT = PMO_RECOMMENDATION_SORT_KEYS
const REV = PMO_REVIEW_ACTIONS
const CONV = PMO_CONVERSION_TARGETS

/**
 * PMO AI 优先级推荐验证器（v3-pmo-ai-priority-recommendations §3.3）。
 *
 * 所有参数必须在运行查询前被白名单和上限约束。
 * 不接受 client-supplied `organizationId`。
 */

/** 队列列表查询验证器。 */
export const pmoAiPriorityRecommendationListValidator = vine.compile(
  vine.object({
    status: vine.enum(STS).optional(),
    severity: vine.enum(SEV).optional(),
    sourceType: vine.enum(SRC).optional(),
    aiStatus: vine.enum(AI_ST).optional(),
    stale: vine.boolean().optional(),
    priorityLevel: vine.enum(['critical', 'high', 'medium', 'low']).optional(),
    projectId: vine.number().positive().optional(),
    q: vine.string().maxLength(200).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(PMO_RECOMMENDATION_MAX_PER_PAGE).optional(),
    sort: vine.enum(SORT).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
  }),
)

/** 摘要查询验证器。 */
export const pmoAiPriorityRecommendationSummaryValidator = vine.compile(
  vine.object({
    includeWarnings: vine.boolean().optional(),
    includeTop: vine.number().positive().max(20).optional(),
  }),
)

/** 详情 ID 参数验证器。 */
export const pmoAiPriorityRecommendationIdValidator = vine.compile(
  vine.object({
    id: vine.number().positive(),
  }),
)

/** AI 理由请求体验证器。 */
export const pmoAiRationaleRequestValidator = vine.compile(
  vine.object({
    idempotencyKey: vine.string().maxLength(128).optional(),
  }),
)

/** 审查动作请求体验证器。 */
export const pmoReviewActionValidator = vine.compile(
  vine.object({
    action: vine.enum(REV),
    reason: vine.string().maxLength(500).optional(),
    snoozeUntil: vine.string().maxLength(30).optional(),
    convertTarget: vine.enum(CONV).optional(),
    convertParams: vine.any().optional(),
  }),
)
