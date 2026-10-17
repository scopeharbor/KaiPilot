import vine from '@vinejs/vine'
import {
  RESOURCE_SKILL_MATRIX_GROUP_BY_VALUES,
  RESOURCE_SKILL_MATRIX_MAX_DATE_WINDOW_DAYS,
  RESOURCE_SKILL_MATRIX_MAX_TOP_N,
  RESOURCE_SKILL_MATRIX_SCOPES,
  RESOURCE_SKILL_MATRIX_SORT_FIELD_VALUES,
} from '@aiproj/types'

/**
 * 资源技能矩阵验证器（v3-resource-skill-matrix §3.1）。
 * 所有查询参数必须在聚合执行前通过白名单和上限约束。
 */
const scope = () =>
  vine.enum([RESOURCE_SKILL_MATRIX_SCOPES.ORGANIZATION, RESOURCE_SKILL_MATRIX_SCOPES.PROJECT])
const groupBy = () => vine.enum(RESOURCE_SKILL_MATRIX_GROUP_BY_VALUES)
const sort = () => vine.enum(RESOURCE_SKILL_MATRIX_SORT_FIELD_VALUES)

const sharedQueryFields = {
  scope: scope().optional(),
  projectIds: vine.string().maxLength(2000).optional(),
  skillKeys: vine.string().maxLength(2000).optional(),
  resourceStatuses: vine.string().maxLength(500).optional(),
  requirementStatuses: vine.string().maxLength(500).optional(),
  includeSkillAdvisory: vine.boolean().optional(),
  from: vine.string().maxLength(10).optional(),
  to: vine.string().maxLength(10).optional(),
  topN: vine.number().positive().max(RESOURCE_SKILL_MATRIX_MAX_TOP_N).optional(),
  groupBy: groupBy().optional(),
  sort: sort().optional(),
  search: vine.string().maxLength(200).optional(),
  page: vine.number().positive().optional(),
  perPage: vine.number().positive().max(100).optional(),
}

export const resourceSkillMatrixSummaryValidator = vine.compile(vine.object(sharedQueryFields))

export const resourceSkillMatrixMatrixValidator = vine.compile(vine.object(sharedQueryFields))

export const resourceSkillMatrixCoverageValidator = vine.compile(vine.object(sharedQueryFields))

export const resourceSkillMatrixGapsValidator = vine.compile(vine.object(sharedQueryFields))

export const resourceSkillMatrixCandidatesValidator = vine.compile(
  vine.object({
    ...sharedQueryFields,
    skillKey: vine.string().trim().maxLength(120),
  }),
)

export const resourceSkillMatrixSkillDetailValidator = vine.compile(
  vine.object({
    skillKey: vine.string().trim().maxLength(120),
    scope: scope().optional(),
    projectIds: vine.string().maxLength(2000).optional(),
    includeSkillAdvisory: vine.boolean().optional(),
    from: vine.string().maxLength(10).optional(),
    to: vine.string().maxLength(10).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

export const resourceSkillMatrixDrillDownValidator = vine.compile(
  vine.object({
    itemType: vine.enum(['resource', 'task_requirement', 'project']),
    skillKey: vine.string().trim().maxLength(120),
    scope: scope().optional(),
    projectIds: vine.string().maxLength(2000).optional(),
    from: vine.string().maxLength(10).optional(),
    to: vine.string().maxLength(10).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

/**
 * 验证日期窗口是否在允许范围内。
 * 返回 { valid, from, to, windowDays }。
 */
export function validateDateWindow(
  from?: string,
  to?: string,
):
  { valid: true; from: string; to: string; windowDays: number } | { valid: false; reason: string } {
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const defaultTo = now.toISOString().split('T')[0]

  const resolvedFrom = from ?? defaultFrom
  const resolvedTo = to ?? defaultTo

  const fromDate = new Date(resolvedFrom)
  const toDate = new Date(resolvedTo)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return { valid: false, reason: '日期格式无效' }
  }

  if (fromDate > toDate) {
    return { valid: false, reason: '起始日期不能晚于结束日期' }
  }

  const windowDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000))
  if (windowDays > RESOURCE_SKILL_MATRIX_MAX_DATE_WINDOW_DAYS) {
    return {
      valid: false,
      reason: `日期窗口不能超过 ${RESOURCE_SKILL_MATRIX_MAX_DATE_WINDOW_DAYS} 天`,
    }
  }

  return { valid: true, from: resolvedFrom, to: resolvedTo, windowDays }
}

/**
 * 解析逗号分隔的字符串为数字数组，用于 projectIds/skillKeys 多选参数。
 */
export function parseCsvNumbers(input?: string): number[] {
  if (!input) return []
  return input
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
}

/**
 * 解析逗号分隔的字符串为字符串数组。
 */
export function parseCsvStrings(input?: string): string[] {
  if (!input) return []
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}
