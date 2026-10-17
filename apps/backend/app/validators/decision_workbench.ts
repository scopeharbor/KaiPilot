import vine from '@vinejs/vine'
import {
  PMO_DECISION_CASE_STATUS_VALUES,
  PMO_DECISION_HANDOFF_TARGET_VALUES,
  PMO_DECISION_MAX_PAGE_SIZE,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— API 验证器（tasks 9.1）。
 *
 * 红线：闭集枚举、长度上限、revision/幂等键约束在进入 Service 前强制；
 * unknown field 由 vine.object 默认剔除，不进入业务层。
 */

export const decisionWorkbenchParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    decisionId: vine.number().positive().optional(),
  }),
)

/** case 列表筛选（状态/owner/due/attention + 分页 + 稳定排序）。 */
export const decisionCaseListQueryValidator = vine.compile(
  vine.object({
    status: vine.enum(PMO_DECISION_CASE_STATUS_VALUES).optional(),
    ownerId: vine.number().positive().optional(),
    attention: vine.boolean().optional(),
    page: vine.number().positive().max(10_000).optional(),
    perPage: vine.number().positive().max(PMO_DECISION_MAX_PAGE_SIZE).optional(),
    sort: vine.enum(['dueDate', 'createdAt', 'updatedAt', 'title']).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
  }),
)

export const decisionCreateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200),
    decisionQuestion: vine.string().trim().minLength(1).maxLength(500),
    scopeSummary: vine.string().trim().maxLength(300).optional(),
    ownerId: vine.number().positive(),
    dueDate: vine.date().optional(),
  }),
)

export const decisionUpdateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200).optional(),
    decisionQuestion: vine.string().trim().minLength(1).maxLength(500).optional(),
    scopeSummary: vine.string().trim().maxLength(300).optional(),
    ownerId: vine.number().positive().optional(),
    dueDate: vine.date().nullable().optional(),
    expectedRevision: vine.number().positive(),
  }),
)

export const decisionTransitionValidator = vine.compile(
  vine.object({
    to: vine.enum(PMO_DECISION_CASE_STATUS_VALUES),
    expectedRevision: vine.number().positive(),
  }),
)

export const decisionOptionCreateValidator = vine.compile(
  vine.object({
    label: vine.string().trim().minLength(1).maxLength(120),
    assumptions: vine.array(vine.string().trim().maxLength(500)).maxLength(20).optional(),
    constraints: vine.array(vine.string().trim().maxLength(500)).maxLength(20).optional(),
    affectedProjectRefs: vine.array(vine.string().trim().maxLength(120)).maxLength(50).optional(),
    proposedOutcomeCategory: vine.string().trim().minLength(1).maxLength(60),
    evidenceRefs: vine.array(vine.string().trim().maxLength(160)).maxLength(50).optional(),
  }),
)

export const decisionOptionDeactivateValidator = vine.compile(
  vine.object({
    optionId: vine.number().positive(),
    expectedRevision: vine.number().positive(),
  }),
)

export const decisionPositionValidator = vine.compile(
  vine.object({
    stance: vine.enum(['support', 'oppose', 'abstain']),
    note: vine.string().trim().maxLength(500).nullable().optional(),
  }),
)

export const decisionOutcomeValidator = vine.compile(
  vine.object({
    action: vine.enum(['approve', 'reject', 'defer', 'request-more-evidence', 'supersede']),
    selectedOptionId: vine.number().positive().nullable().optional(),
    reviewFingerprint: vine.string().trim().minLength(8).maxLength(32),
    rationale: vine.string().trim().maxLength(2000).nullable().optional(),
    acknowledgedWarnings: vine.array(vine.string().trim().maxLength(60)).maxLength(50).optional(),
    supersededByCaseId: vine.number().positive().nullable().optional(),
  }),
)

export const decisionHandoffCreateValidator = vine.compile(
  vine.object({
    target: vine.enum(PMO_DECISION_HANDOFF_TARGET_VALUES),
    idempotencyKey: vine.string().trim().minLength(4).maxLength(128),
  }),
)
