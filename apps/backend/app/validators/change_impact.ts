import vine from '@vinejs/vine'

/**
 * V2 变更影响分析验证器（v2-change-management-impact-analysis §6.1）。
 */

const impactDimension = () =>
  vine.enum([
    'scope',
    'schedule',
    'resource',
    'risk',
    'quality',
    'assumption',
    'related_object',
  ] as const)

/** 创建影响分析 */
export const createImpactAnalysisValidator = vine.compile(
  vine.object({
    scope: vine
      .object({
        dimensions: vine.array(impactDimension()).minLength(1).optional(),
        maxPropagationDepth: vine.number().withoutDecimals().range([1, 10]).optional(),
        includeEvidenceDetails: vine.boolean().optional(),
        /** 前端早期调用兼容字段；不参与服务层契约。 */
        includeRelatedObjects: vine.boolean().optional(),
      })
      .optional(),
  }),
)

/** 列表查询 */
export const listImpactAnalysesValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

/** 确认分析 */
export const confirmAnalysisValidator = vine.compile(
  vine.object({
    reason: vine.string().maxLength(500).optional(),
  }),
)

/** 确认继续使用过期分析 */
export const confirmStaleAnalysisValidator = vine.compile(
  vine.object({
    reason: vine.string().maxLength(500),
  }),
)

/** AI 解释请求 */
export const aiExplanationValidator = vine.compile(
  vine.object({
    focus: vine.string().maxLength(200).optional(),
  }),
)

/** 审批引用 */
export const approvalReferenceValidator = vine.compile(
  vine.object({
    analysisId: vine.number().positive(),
    confirmStaleReason: vine.string().maxLength(500).optional(),
  }),
)
