import vine from '@vinejs/vine'
import {
  CONTRADICTION_SEVERITIES,
  PHYSICAL_ANALYSIS_RUN_STATUSES,
  PHYSICAL_CANDIDATE_STATUSES,
  SEPARATION_AXES,
} from '@aiproj/types'

/**
 * 创建物理矛盾分析运行校验器（v3-triz-physical-contradiction-analyzer §5.3）。
 */
export const createPhysicalAnalysisValidator = vine.compile(
  vine.object({
    userContext: vine.string().optional(),
    idempotencyKey: vine.string().optional(),
  }),
)

/**
 * 列表运行查询校验器。
 */
export const listPhysicalAnalysesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(PHYSICAL_ANALYSIS_RUN_STATUSES).optional(),
    sort: vine.string().optional(),
  }),
)

/**
 * 列表候选查询校验器。
 */
export const listPhysicalCandidatesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(PHYSICAL_CANDIDATE_STATUSES).optional(),
    severity: vine.enum(CONTRADICTION_SEVERITIES).optional(),
    separationAxis: vine.enum(SEPARATION_AXES).optional(),
    stale: vine.boolean().optional(),
    sort: vine.string().optional(),
  }),
)

/**
 * 审查候选校验器。
 */
export const reviewPhysicalCandidateValidator = vine.compile(
  vine.object({
    action: vine.enum(['mark_reviewed', 'mark_unreviewed', 'dismiss']),
    reason: vine.string().optional(),
  }),
)

/**
 * AI 解释请求校验器。
 */
export const explainPhysicalCandidateValidator = vine.compile(vine.object({}))
