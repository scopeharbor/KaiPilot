import vine from '@vinejs/vine'
import {
  TECHNICAL_ANALYSIS_RUN_STATUSES,
  TECHNICAL_CANDIDATE_STATUSES,
  TECHNICAL_SORT_FIELDS,
} from '@aiproj/types'
import type { ContradictionSeverity } from '@aiproj/types'

/**
 * 技术矛盾分析器校验器集（v3-triz-technical-contradiction-analyzer §3.6）。
 *
 * status/severity/sort 使用枚举校验，非法值返回 VALIDATION_ERROR（Requirement 6）。
 */

const SEVERITIES: ContradictionSeverity[] = ['critical', 'high', 'medium', 'low']

/** 创建技术矛盾分析运行校验器 */
export const createTechnicalAnalysisValidator = vine.compile(
  vine.object({
    userContext: vine.string().optional(),
    idempotencyKey: vine.string().optional(),
  }),
)

/** 列表运行查询校验器 */
export const listTechnicalAnalysesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(TECHNICAL_ANALYSIS_RUN_STATUSES).optional(),
    sort: vine.enum(TECHNICAL_SORT_FIELDS).optional(),
  }),
)

/** 列表候选查询校验器 */
export const listTechnicalCandidatesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(TECHNICAL_CANDIDATE_STATUSES).optional(),
    severity: vine.enum(SEVERITIES).optional(),
    stale: vine.boolean().optional(),
    sort: vine.enum(TECHNICAL_SORT_FIELDS).optional(),
  }),
)

/** 审查候选校验器 */
export const reviewTechnicalCandidateValidator = vine.compile(
  vine.object({
    action: vine.enum(['mark_reviewed', 'mark_unreviewed', 'dismiss']),
    reason: vine.string().optional(),
  }),
)

/** AI 解释请求校验器 */
export const explainTechnicalCandidateValidator = vine.compile(vine.object({}))
