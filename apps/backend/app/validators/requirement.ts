import vine from '@vinejs/vine'

/**
 * 需求校验器（v3-chart-gallery-data-foundation）。
 *
 * 仅做字段级格式校验；编号唯一性、任务归属项目（跨租户 404）、验收准则
 * 状态迁移语义由 RequirementService 层判定。
 */

const requirementCode = () => vine.string().trim().minLength(1).maxLength(64)

const criterionStatus = () => vine.enum(['pending', 'passed', 'failed'] as const)

/** 结构化验收准则条目：{ id, statement, status }。 */
const acceptanceCriterion = () =>
  vine.object({
    id: vine.string().trim().minLength(1).maxLength(64),
    statement: vine.string().trim().minLength(1).maxLength(2000),
    status: criterionStatus(),
  })

const acceptanceCriteria = () => vine.array(acceptanceCriterion()).maxLength(200)

/** 单条验收准则状态流转指令（PATCH /:id 与验收状态单独更新的表达）。 */
const criterionUpdate = () =>
  vine.object({
    id: vine.string().trim().minLength(1).maxLength(64),
    status: criterionStatus(),
  })

const pageQuery = () => vine.number().withoutDecimals().range([1, 100000]).optional()
const perPageQuery = () => vine.number().withoutDecimals().range([1, 100]).optional()

export const createRequirementValidator = vine.compile(
  vine.object({
    code: requirementCode().nullable().optional(),
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(10000).nullable().optional(),
    category: vine
      .enum(['business', 'user', 'functional', 'non_functional', 'other'] as const)
      .optional(),
    priority: vine.enum(['lowest', 'low', 'medium', 'high', 'highest'] as const).optional(),
    status: vine
      .enum(['draft', 'approved', 'in_progress', 'completed', 'cancelled'] as const)
      .optional(),
    acceptanceCriteria: acceptanceCriteria().optional(),
  }),
)

export const updateRequirementValidator = vine.compile(
  vine.object({
    code: requirementCode().nullable().optional(),
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().maxLength(10000).nullable().optional(),
    category: vine
      .enum(['business', 'user', 'functional', 'non_functional', 'other'] as const)
      .optional(),
    priority: vine.enum(['lowest', 'low', 'medium', 'high', 'highest'] as const).optional(),
    status: vine
      .enum(['draft', 'approved', 'in_progress', 'completed', 'cancelled'] as const)
      .optional(),
    // 整表替换验收准则
    acceptanceCriteria: acceptanceCriteria().optional(),
    // 按 id 单独流转验收准则状态（pending → passed / failed）
    criterionUpdates: vine.array(criterionUpdate()).maxLength(200).optional(),
  }),
)

export const listRequirementsValidator = vine.compile(
  vine.object({
    category: vine
      .enum(['business', 'user', 'functional', 'non_functional', 'other'] as const)
      .optional(),
    priority: vine.enum(['lowest', 'low', 'medium', 'high', 'highest'] as const).optional(),
    status: vine
      .enum(['draft', 'approved', 'in_progress', 'completed', 'cancelled'] as const)
      .optional(),
    page: pageQuery(),
    perPage: perPageQuery(),
  }),
)

export const bindTaskValidator = vine.compile(
  vine.object({
    taskId: vine.number().withoutDecimals().positive(),
  }),
)
