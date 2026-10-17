import vine from '@vinejs/vine'
import { HEALTH_DIAGNOSIS_STATUSES } from '@aiproj/types'

/**
 * V2 项目健康诊断验证器（v2-ai-project-health-diagnosis §5.1）。
 * 覆盖：列表分页、状态筛选、日期范围、生成参数、确认说明、驳回原因和 stale 确认原因。
 */

/** 列表查询 */
export const listDiagnosesValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    status: vine.enum(HEALTH_DIAGNOSIS_STATUSES).optional(),
    sort: vine.string().maxLength(50).optional(),
    dateFrom: vine.string().maxLength(30).optional(),
    dateTo: vine.string().maxLength(30).optional(),
  }),
)

/** 生成诊断（可选项：是否启用 AI 草稿） */
export const generateDiagnosisValidator = vine.compile(
  vine.object({
    enableAiDraft: vine.boolean().optional(),
  }),
)

/** 确认诊断 */
export const confirmDiagnosisValidator = vine.compile(
  vine.object({
    notes: vine.string().maxLength(1000).optional(),
  }),
)

/** 驳回诊断 */
export const rejectDiagnosisValidator = vine.compile(
  vine.object({
    reason: vine.string().minLength(1).maxLength(1000),
  }),
)

/** 确认 stale 诊断继续使用 */
export const confirmStaleDiagnosisValidator = vine.compile(
  vine.object({
    reason: vine.string().maxLength(1000).optional(),
  }),
)
