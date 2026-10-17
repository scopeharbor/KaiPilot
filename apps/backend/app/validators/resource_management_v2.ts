import vine from '@vinejs/vine'

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

const loadStatus = () =>
  vine.enum(['idle', 'available', 'full', 'overloaded', 'unavailable'] as const)

const requirementPriority = () => vine.enum(['low', 'medium', 'high', 'critical'] as const)

const requirementStatus = () => vine.enum(['open', 'matched', 'fulfilled', 'cancelled'] as const)

const sourceKind = () =>
  vine.enum(['manual', 'compiler', 'ai_candidate', 'rule_suggestion'] as const)

const availabilityStatus = () => vine.enum(['planned', 'confirmed', 'cancelled'] as const)

const skillTags = () => vine.array(vine.string().trim().maxLength(64)).minLength(0).maxLength(50)

export const resourcePlanningQueryValidator = vine.compile(
  vine.object({
    from: isoDate(),
    to: isoDate(),
    resourceId: vine.number().withoutDecimals().positive().optional(),
    role: vine.string().trim().maxLength(80).optional(),
    skill: vine.string().trim().maxLength(64).optional(),
    resourceStatus: vine.enum(['active', 'inactive'] as const).optional(),
    loadStatus: loadStatus().optional(),
  }),
)

export const listTaskResourceRequirementsValidator = vine.compile(
  vine.object({
    taskId: vine.number().withoutDecimals().positive().optional(),
    role: vine.string().trim().maxLength(80).optional(),
    status: requirementStatus().optional(),
    from: isoDate().optional(),
    to: isoDate().optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

export const createTaskResourceRequirementValidator = vine.compile(
  vine.object({
    taskId: vine.number().withoutDecimals().positive(),
    role: vine.string().trim().minLength(1).maxLength(80),
    skillTags: skillTags().optional(),
    allocationPercent: vine.number().range([0.01, 1000]).nullable().optional(),
    estimatedPersonDays: vine.number().range([0.01, 100000]).nullable().optional(),
    startDate: isoDate(),
    endDate: isoDate(),
    priority: requirementPriority().optional(),
    status: requirementStatus().optional(),
    sourceKind: sourceKind().optional(),
    sourceRef: vine.string().trim().maxLength(120).nullable().optional(),
  }),
)

export const updateTaskResourceRequirementValidator = vine.compile(
  vine.object({
    role: vine.string().trim().minLength(1).maxLength(80).optional(),
    skillTags: skillTags().nullable().optional(),
    allocationPercent: vine.number().range([0.01, 1000]).nullable().optional(),
    estimatedPersonDays: vine.number().range([0.01, 100000]).nullable().optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().optional(),
    priority: requirementPriority().optional(),
    status: requirementStatus().optional(),
    sourceKind: sourceKind().optional(),
    sourceRef: vine.string().trim().maxLength(120).nullable().optional(),
  }),
)

export const resourceMatchQueryValidator = vine.compile(
  vine.object({
    limit: vine.number().withoutDecimals().range([1, 50]).optional(),
  }),
)

export const listResourceAvailabilityExceptionsValidator = vine.compile(
  vine.object({
    from: isoDate().optional(),
    to: isoDate().optional(),
    status: availabilityStatus().optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

export const createResourceAvailabilityExceptionValidator = vine.compile(
  vine.object({
    startDate: isoDate(),
    endDate: isoDate(),
    capacityOverrideHours: vine.number().range([0, 24]),
    reason: vine.string().trim().minLength(1).maxLength(255),
    status: availabilityStatus().optional(),
  }),
)

export const updateResourceAvailabilityExceptionValidator = vine.compile(
  vine.object({
    startDate: isoDate().optional(),
    endDate: isoDate().optional(),
    capacityOverrideHours: vine.number().range([0, 24]).optional(),
    reason: vine.string().trim().minLength(1).maxLength(255).optional(),
    status: availabilityStatus().optional(),
  }),
)
