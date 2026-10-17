import vine from '@vinejs/vine'

const allocationType = () => vine.enum(['assigned', 'allocated', 'reserved'] as const)

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

export const createAllocationValidator = vine.compile(
  vine.object({
    taskId: vine.number().withoutDecimals().positive(),
    allocationType: allocationType().optional(),
    allocationPercent: vine.number().range([0, 100]).optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().optional(),
    plannedUnits: vine.number().range([0, 1000000]).nullable().optional(),
    actualUnits: vine.number().range([0, 1000000]).nullable().optional(),
  }),
)

export const updateAllocationValidator = vine.compile(
  vine.object({
    allocationType: allocationType().optional(),
    allocationPercent: vine.number().range([0, 100]).optional(),
    startDate: isoDate().nullable().optional(),
    endDate: isoDate().nullable().optional(),
    plannedUnits: vine.number().range([0, 1000000]).nullable().optional(),
    actualUnits: vine.number().range([0, 1000000]).nullable().optional(),
  }),
)

export const listAllocationsValidator = vine.compile(
  vine.object({
    allocationType: allocationType().optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
