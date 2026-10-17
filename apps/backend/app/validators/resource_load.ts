import vine from '@vinejs/vine'

const viewMode = () => vine.enum(['personal', 'team', 'trend'] as const)

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

export const loadQueryValidator = vine.compile(
  vine.object({
    view: viewMode().optional(),
    from: isoDate(),
    to: isoDate(),
    resourceId: vine.number().withoutDecimals().positive().optional(),
  }),
)
