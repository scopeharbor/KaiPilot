import vine from '@vinejs/vine'

const resourceType = () => vine.enum(['human', 'material', 'equipment', 'budget'] as const)

const resourceRole = () =>
  vine.enum(['owner', 'project_manager', 'team_lead', 'member', 'viewer'] as const)

const resourceStatus = () => vine.enum(['active', 'inactive'] as const)

const capacityCalendarPolicy = () =>
  vine.enum(['project_working_calendar', 'resource_work_days'] as const)

const workDays = () =>
  vine
    .array(vine.number().withoutDecimals().range([0, 6]))
    .minLength(0)
    .maxLength(7)

const skillTags = () => vine.array(vine.string().trim().maxLength(64)).minLength(0).maxLength(50)
const roleTags = () => vine.array(vine.string().trim().maxLength(64)).minLength(0).maxLength(30)

const timezoneStr = () => vine.string().trim().maxLength(64)

export const createResourceValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    email: vine.string().trim().maxLength(255).nullable().optional(),
    resourceType: resourceType().optional(),
    role: resourceRole().optional(),
    status: resourceStatus().optional(),
    capacityVersion: vine.number().withoutDecimals().range([1, 1]).optional(),
    capacityCalendarPolicy: capacityCalendarPolicy().optional(),
    dailyCapacityHours: vine.number().range([0, 24]).optional(),
    skillTags: skillTags().optional(),
    roleTags: roleTags().optional(),
    capacityProfile: vine.record(vine.any()).nullable().optional(),
    workDays: workDays().optional(),
    timezone: timezoneStr().optional(),
    costPerUnitCents: vine
      .number()
      .withoutDecimals()
      .range([0, Number.MAX_SAFE_INTEGER])
      .nullable()
      .optional(),
    userId: vine.number().withoutDecimals().positive().nullable().optional(),
  }),
)

export const updateResourceValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    email: vine.string().trim().maxLength(255).nullable().optional(),
    resourceType: resourceType().optional(),
    role: resourceRole().optional(),
    status: resourceStatus().optional(),
    capacityVersion: vine.number().withoutDecimals().range([1, 1]).optional(),
    capacityCalendarPolicy: capacityCalendarPolicy().optional(),
    dailyCapacityHours: vine.number().range([0, 24]).optional(),
    skillTags: skillTags().optional(),
    roleTags: roleTags().optional(),
    capacityProfile: vine.record(vine.any()).nullable().optional(),
    workDays: workDays().optional(),
    timezone: timezoneStr().optional(),
    costPerUnitCents: vine
      .number()
      .withoutDecimals()
      .range([0, Number.MAX_SAFE_INTEGER])
      .nullable()
      .optional(),
    userId: vine.number().withoutDecimals().positive().nullable().optional(),
  }),
)

export const listResourcesValidator = vine.compile(
  vine.object({
    resourceType: resourceType().optional(),
    status: resourceStatus().optional(),
    role: resourceRole().optional(),
    search: vine.string().trim().maxLength(255).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
