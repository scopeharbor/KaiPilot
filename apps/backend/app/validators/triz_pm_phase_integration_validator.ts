import vine from '@vinejs/vine'
import {
  PHASE_HANDOFF_TARGETS,
  PM_PHASE_IDS,
  PM_SOURCE_KINDS,
  PHASE_RUN_STATUSES,
} from '@aiproj/types'

/**
 * TRIZ-PM 阶段整合 Validators（v3-triz-pm-phase-integration §5.1）。
 *
 * 枚举一律走 vine.enum(契约常量)：`.in()` 会把输出类型放宽成 string，
 * 下游拿不到字面量联合；直接引用 @aiproj/types 常量也保证与契约同源。
 */

export const createRunValidator = vine.compile(
  vine.object({
    userNotes: vine.string().optional(),
    scopeFilter: vine.array(vine.enum(PM_SOURCE_KINDS)).optional(),
  }),
)

export const listRunsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    status: vine.enum(PHASE_RUN_STATUSES).optional(),
    sort: vine.string().optional(),
  }),
)

export const reviewPhaseValidator = vine.compile(
  vine.object({
    phaseId: vine.enum(PM_PHASE_IDS),
    reviewNotes: vine.string().optional(),
  }),
)

export const explainPhaseValidator = vine.compile(
  vine.object({
    phaseId: vine.enum(PM_PHASE_IDS),
  }),
)

export const handoffPreviewValidator = vine.compile(
  vine.object({
    phaseId: vine.enum(PM_PHASE_IDS),
    recommendationId: vine.string(),
    target: vine.enum(PHASE_HANDOFF_TARGETS),
  }),
)
export type PmPhaseHandoffPreviewRequest = Parameters<typeof handoffPreviewValidator.validate>[0]
