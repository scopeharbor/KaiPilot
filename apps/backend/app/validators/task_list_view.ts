import vine from '@vinejs/vine'

const statusList =
  /^(?:not_started|in_progress|completed|blocked|on_hold|cancelled)(?:,(?:not_started|in_progress|completed|blocked|on_hold|cancelled))*$/
const priorityList = /^(?:lowest|low|medium|high|highest)(?:,(?:lowest|low|medium|high|highest))*$/
const assigneeList = /^\d+(?:,\d+)*$/
const sortList =
  /^[+-](?:name|priority|status|assignee|progressPercent|endDate|estimatedHours|actualHours|createdAt|updatedAt)(?:,[+-](?:name|priority|status|assignee|progressPercent|endDate|estimatedHours|actualHours|createdAt|updatedAt)){0,2}$/
const isoDate = /^\d{4}-\d{2}-\d{2}$/
const statuses = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
] as const
const priorities = ['lowest', 'low', 'medium', 'high', 'highest'] as const
const sortTerms = [
  '+name',
  '-name',
  '+priority',
  '-priority',
  '+status',
  '-status',
  '+assignee',
  '-assignee',
  '+progressPercent',
  '-progressPercent',
  '+endDate',
  '-endDate',
  '+estimatedHours',
  '-estimatedHours',
  '+actualHours',
  '-actualHours',
  '+createdAt',
  '-createdAt',
  '+updatedAt',
  '-updatedAt',
] as const

export const listTaskViewValidator = vine.compile(
  vine.object({
    search: vine.string().trim().maxLength(255).optional(),
    status: vine
      .unionOfTypes([
        vine.string().trim().regex(statusList),
        vine.array(vine.enum(statuses)).maxLength(6).distinct(),
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
    dateFrom: vine.string().trim().regex(isoDate).optional(),
    dateTo: vine.string().trim().regex(isoDate).optional(),
    sort: vine
      .unionOfTypes([
        vine.string().trim().regex(sortList),
        vine.array(vine.enum(sortTerms)).maxLength(3).distinct(),
      ])
      .optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
