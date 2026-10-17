import vine from '@vinejs/vine'
import {
  TRIZ_CONTRADICTION_TYPES,
  TRIZ_MAPPING_PATHS,
} from '#services/triz_copilot/triz_contradiction_mapping_service'

/**
 * v3-triz-contradiction-copilot 任务 2.2 —— 矛盾求解对话流校验器。
 *
 * 只校验请求体/查询串的**形状与闭集**：业务存在性（项目 / 分析记录归属）、权限、预算上限的
 * 收紧与知识包编号闭集由 Controller 与服务层判定（跨组织统一 404）。
 *
 * 陈述长度上限取宽松输入界（4000）：超长陈述由映射服务按 `maxStatementChars` 确定性截断并
 * 以 `statementTruncated` 诚实披露（不因长度拒绝用户），低于 1 字符则 422。
 */
const budgetValidator = vine.object({
  clarificationRounds: vine.number().positive().optional(),
  metricReads: vine.number().positive().optional(),
  runTokens: vine.number().positive().optional(),
})

const solveValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    statement: vine.string().trim().minLength(1).maxLength(4000),
    asOfDate: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    parentAnalysisId: vine.number().positive().optional(),
    sourceSignalId: vine.number().positive().optional(),
    forceRulePath: vine.boolean().optional(),
    budget: budgetValidator.optional(),
  }),
)

const listValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    path: vine.enum(TRIZ_MAPPING_PATHS).optional(),
    humanOverride: vine.boolean().optional(),
  }),
)

const showValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    analysisId: vine.number().positive(),
  }),
)

/** 改判：至少提供一项参数由服务层判定（422）；此处只约束形状与 1–39 的编号闭集。 */
const overrideValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    analysisId: vine.number().positive(),
    improvingParameter: vine.number().positive().min(1).max(39).optional(),
    worseningParameter: vine.number().positive().min(1).max(39).optional(),
    contradictionType: vine.enum(TRIZ_CONTRADICTION_TYPES).optional(),
    reason: vine.string().trim().maxLength(500).optional().nullable(),
    budget: budgetValidator.optional(),
  }),
)

export { solveValidator, listValidator, showValidator, overrideValidator }
