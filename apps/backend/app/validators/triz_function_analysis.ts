import vine from '@vinejs/vine'
import {
  FUNCTION_ANALYSIS_RUN_STATUSES,
  FUNCTION_ISSUE_TYPES,
  FUNCTION_ISSUE_CANDIDATE_STATUSES,
} from '@aiproj/types'
import type { FunctionIssueSeverity } from '@aiproj/types'

/**
 * 功能分析图校验器集（v3-triz-function-analysis-diagram §3.6）。
 *
 * status/severity/issueType/sort 使用枚举校验，非法值返回 VALIDATION_ERROR。
 */

const SEVERITIES: FunctionIssueSeverity[] = ['critical', 'high', 'medium', 'low']

/** 创建功能分析运行校验器 */
export const createFunctionAnalysisValidator = vine.compile(
  vine.object({
    manualComponents: vine
      .array(
        vine.object({
          name: vine.string(),
          description: vine.string().optional(),
          relatesTo: vine.array(vine.string()).optional(),
          functionType: vine
            .enum(['useful', 'harmful', 'insufficient', 'excessive'] as const)
            .optional(),
          strength: vine.number().min(0).max(1).optional(),
        }),
      )
      .optional(),
    userContext: vine.string().optional(),
    idempotencyKey: vine.string().optional(),
  }),
)

/** 列表运行查询校验器 */
export const listFunctionAnalysesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(FUNCTION_ANALYSIS_RUN_STATUSES).optional(),
    sort: vine.string().optional(),
  }),
)

/** 列表问题候选查询校验器 */
export const listFunctionIssuesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    issueType: vine.enum(FUNCTION_ISSUE_TYPES).optional(),
    severity: vine.enum(SEVERITIES).optional(),
    status: vine.enum(FUNCTION_ISSUE_CANDIDATE_STATUSES).optional(),
    stale: vine.boolean().optional(),
    sort: vine.string().optional(),
  }),
)

/** 审查问题候选校验器 */
export const reviewFunctionIssueValidator = vine.compile(
  vine.object({
    action: vine.enum(['reviewed', 'dismissed', 'needs_more_info']),
    reason: vine.string().optional(),
  }),
)

/** AI 解释请求校验器 */
export const explainFunctionIssueValidator = vine.compile(vine.object({}))
