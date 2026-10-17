import vine from '@vinejs/vine'

export const createTaskDependencyValidator = vine.compile(
  vine.object({
    predecessorId: vine.number().withoutDecimals().positive(),
    type: vine.enum(['fs', 'ss', 'ff', 'sf'] as const).optional(),
    lagDays: vine.number().withoutDecimals().optional(),
  }),
)
