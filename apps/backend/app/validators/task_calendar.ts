import vine from '@vinejs/vine'

const isoDate = /^\d{4}-\d{2}-\d{2}$/
const statuses = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
  'achieved',
  'missed',
  'at_risk',
] as const
const priorities = ['lowest', 'low', 'medium', 'high', 'highest'] as const
const itemTypes = ['task', 'milestone'] as const

const statusList =
  /^(?:not_started|in_progress|completed|blocked|on_hold|cancelled|achieved|missed|at_risk)(?:,(?:not_started|in_progress|completed|blocked|on_hold|cancelled|achieved|missed|at_risk))*$/
const priorityList = /^(?:lowest|low|medium|high|highest)(?:,(?:lowest|low|medium|high|highest))*$/
const assigneeList = /^\d+(?:,\d+)*$/
const itemTypeList = /^(?:task|milestone)(?:,(?:task|milestone))*$/

/**
 * Calendar 查询校验器。
 *
 * 支持 V1 截止日模式（mode=deadline）与 V2 完整模式（mode=schedule）。
 * 两种模式共享相同的日期窗口、筛选和分页校验规则。
 * mode 参数向后兼容：旧客户端不传 mode 时默认 deadline 模式。
 */
export const taskCalendarValidator = vine.compile(
  vine.object({
    view: vine.enum(['month', 'week', 'day'] as const),
    anchorDate: vine.string().trim().regex(isoDate),
    dateFrom: vine.string().trim().regex(isoDate).optional(),
    dateTo: vine.string().trim().regex(isoDate).optional(),
    mode: vine.enum(['deadline', 'schedule'] as const).optional(),
    search: vine.string().trim().maxLength(255).optional(),
    status: vine
      .unionOfTypes([
        vine.string().trim().regex(statusList),
        vine.array(vine.enum(statuses)).maxLength(9).distinct(),
      ])
      .optional(),
    priority: vine
      .unionOfTypes([
        vine.string().trim().regex(priorityList),
        vine.array(vine.enum(priorities)).maxLength(5).distinct(),
      ])
      .optional(),
    assigneeId: vine
      .unionOfTypes([
        vine.string().trim().regex(assigneeList),
        vine.array(vine.number().withoutDecimals().positive()).maxLength(100).distinct(),
      ])
      .optional(),
    itemTypes: vine
      .unionOfTypes([
        vine.string().trim().regex(itemTypeList),
        vine.array(vine.enum(itemTypes)).maxLength(2).distinct(),
      ])
      .optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 200]).optional(),
  }),
)

/**
 * Calendar 完整模式专用校验器（额外限制）。
 * schedule 模式下必传 mode=schedule。
 */
export const calendarFullValidator = vine.compile(
  vine.object({
    mode: vine.enum(['schedule'] as const),
    view: vine.enum(['month', 'week', 'day'] as const),
    anchorDate: vine.string().trim().regex(isoDate),
    dateFrom: vine.string().trim().regex(isoDate).optional(),
    dateTo: vine.string().trim().regex(isoDate).optional(),
    search: vine.string().trim().maxLength(255).optional(),
    status: vine
      .unionOfTypes([
        vine.string().trim().regex(statusList),
        vine.array(vine.enum(statuses)).maxLength(9).distinct(),
      ])
      .optional(),
    priority: vine
      .unionOfTypes([
        vine.string().trim().regex(priorityList),
        vine.array(vine.enum(priorities)).maxLength(5).distinct(),
      ])
      .optional(),
    assigneeId: vine
      .unionOfTypes([
        vine.string().trim().regex(assigneeList),
        vine.array(vine.number().withoutDecimals().positive()).maxLength(100).distinct(),
      ])
      .optional(),
    itemTypes: vine
      .unionOfTypes([
        vine.string().trim().regex(itemTypeList),
        vine.array(vine.enum(itemTypes)).maxLength(2).distinct(),
      ])
      .optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 200]).optional(),
  }),
)
