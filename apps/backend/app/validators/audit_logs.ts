import vine from '@vinejs/vine'

const actionList =
  /^(?:create|read|update|delete|export|import|login|logout|approve|reject|ai_generate|apply|rollback)(?:,(?:create|read|update|delete|export|import|login|logout|approve|reject|ai_generate|apply|rollback))*$/
const severityList = /^(?:info|warning|error|critical)(?:,(?:info|warning|error|critical))*$/

const actionEnum = () =>
  vine.enum([
    'create',
    'read',
    'update',
    'delete',
    'export',
    'import',
    'login',
    'logout',
    'approve',
    'reject',
    'ai_generate',
    'apply',
    'rollback',
  ] as const)

const severityEnum = () => vine.enum(['info', 'warning', 'error', 'critical'] as const)

export const listAuditLogsValidator = vine.compile(
  vine.object({
    actorId: vine.number().withoutDecimals().positive().optional(),
    action: vine
      .unionOfTypes([vine.string().trim().regex(actionList), vine.array(actionEnum())])
      .optional(),
    entityType: vine.string().trim().maxLength(100).optional(),
    entityId: vine.number().withoutDecimals().positive().optional(),
    severity: vine
      .unionOfTypes([vine.string().trim().regex(severityList), vine.array(severityEnum())])
      .optional(),
    dateFrom: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
      .optional(),
    dateTo: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
      .optional(),
    requestId: vine.string().trim().maxLength(100).optional(),
    event: vine.string().trim().maxLength(100).optional(),
    cursor: vine.number().withoutDecimals().positive().optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 1000]).optional(),
  }),
)

export const showAuditLogValidator = vine.compile(
  vine.object({
    id: vine.number().withoutDecimals().positive(),
  }),
)

export const statsAuditLogsValidator = vine.compile(
  vine.object({
    dateFrom: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
      .optional(),
    dateTo: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
      .optional(),
  }),
)
