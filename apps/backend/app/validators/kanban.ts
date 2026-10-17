import vine from '@vinejs/vine'

const taskStatus = () =>
  vine.enum(['not_started', 'in_progress', 'completed', 'blocked', 'on_hold', 'cancelled'] as const)

export const listKanbanColumnValidator = vine.compile(
  vine.object({
    column: vine.enum(['pending', 'in_progress', 'completed', 'other'] as const),
    priority: vine.enum(['lowest', 'low', 'medium', 'high', 'highest'] as const).optional(),
    assigneeId: vine.number().withoutDecimals().positive().optional(),
    search: vine.string().trim().maxLength(255).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

export const moveKanbanTaskValidator = vine.compile(
  vine.object({
    taskId: vine.number().withoutDecimals().positive(),
    targetColumn: vine.enum(['pending', 'in_progress', 'completed', 'other'] as const),
    targetStatus: taskStatus().optional(),
    beforeTaskId: vine.number().withoutDecimals().positive().optional(),
    afterTaskId: vine.number().withoutDecimals().positive().optional(),
    /** 移入「其他」列时的说明（如阻塞原因），写入任务与通知。 */
    note: vine.string().trim().maxLength(2000).optional(),
  }),
)
