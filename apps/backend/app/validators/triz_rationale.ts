import vine from '@vinejs/vine'
import { RATIONALE_SOURCE_TYPES, RATIONALE_FEEDBACK_REASONS } from '@aiproj/types'

/**
 * v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由校验器。
 *
 * 所有校验器仅验证请求体的结构与类型，
 * 业务存在性与权限由 Controller/Service 层判定。
 */

/**
 * 推荐理由读取参数校验：路径参数 targetType + targetId。
 */
export const rationaleReadParamsValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    targetType: vine.enum(RATIONALE_SOURCE_TYPES),
    targetId: vine.string().trim().minLength(1).maxLength(255),
  }),
)

/**
 * 反馈提交 payload 校验。
 */
export const feedbackPayloadValidator = vine.compile(
  vine.object({
    reason: vine.enum(RATIONALE_FEEDBACK_REASONS),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)

/**
 * Handoff 请求 payload 校验。
 */
export const handoffPayloadValidator = vine.compile(
  vine.object({
    selectedPrinciple: vine.string().trim().maxLength(500).optional().nullable(),
  }),
)
