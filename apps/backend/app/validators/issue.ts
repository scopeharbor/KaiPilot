import vine from '@vinejs/vine'

/**
 * 议题缺陷校验器（v3-chart-gallery-data-foundation）。
 *
 * 仅做字段级格式校验；状态机合法流转、resolved 根因必填、任务归属项目
 * （跨租户 404）等业务规则由 IssueService 层判定。
 */

const idField = () => vine.number().withoutDecimals().positive()

export const createIssueValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(10000).nullable().optional(),
    type: vine.enum(['bug', 'blocker', 'technical', 'process', 'other'] as const).optional(),
    severity: vine.enum(['critical', 'major', 'minor', 'trivial'] as const).optional(),
    priority: vine.enum(['urgent', 'high', 'medium', 'low'] as const).optional(),
    relatedTaskId: idField().nullable().optional(),
    assigneeId: idField().nullable().optional(),
  }),
)

export const updateIssueValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().maxLength(10000).nullable().optional(),
    type: vine.enum(['bug', 'blocker', 'technical', 'process', 'other'] as const).optional(),
    severity: vine.enum(['critical', 'major', 'minor', 'trivial'] as const).optional(),
    priority: vine.enum(['urgent', 'high', 'medium', 'low'] as const).optional(),
    relatedTaskId: idField().nullable().optional(),
    assigneeId: idField().nullable().optional(),
    rootCause: vine.string().trim().maxLength(5000).nullable().optional(),
    resolution: vine.string().trim().maxLength(5000).nullable().optional(),
  }),
)

export const changeIssueStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(['open', 'in_progress', 'resolved', 'closed', 'rejected'] as const),
    rootCause: vine.string().trim().maxLength(5000).nullable().optional(),
    resolution: vine.string().trim().maxLength(5000).nullable().optional(),
  }),
)

export const listIssuesValidator = vine.compile(
  vine.object({
    type: vine.enum(['bug', 'blocker', 'technical', 'process', 'other'] as const).optional(),
    severity: vine.enum(['critical', 'major', 'minor', 'trivial'] as const).optional(),
    priority: vine.enum(['urgent', 'high', 'medium', 'low'] as const).optional(),
    status: vine
      .enum(['open', 'in_progress', 'resolved', 'closed', 'rejected'] as const)
      .optional(),
    assigneeId: idField().optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
