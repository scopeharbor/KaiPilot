import vine from '@vinejs/vine'

export const ganttScheduleValidator = vine.compile(
  vine.object({
    mode: vine.enum(['preview', 'commit'] as const),
    taskId: vine.number().withoutDecimals().positive(),
    operation: vine.enum(['move', 'resize'] as const),
    startDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    autoSchedule: vine.boolean().optional(),
    previewToken: vine.string().trim().fixedLength(64).nullable().optional(),
  }),
)
