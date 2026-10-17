import vine from '@vinejs/vine'

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

/** 改自己的个人工作日历：休假区间 + 个人工作日（null = 跟随项目）。 */
export const personalCalendarUpdateValidator = vine.compile(
  vine.object({
    workdays: vine
      .array(vine.number().withoutDecimals().range([0, 6]))
      .maxLength(7)
      .nullable(),
    leaves: vine
      .array(
        vine.object({
          id: vine.string().trim().maxLength(40).optional(),
          startDate: isoDate(),
          endDate: isoDate(),
          note: vine.string().trim().maxLength(100).nullable().optional(),
        }),
      )
      .maxLength(200),
  }),
)

/** 「我的日历」查询窗口（最长约一年半）。 */
export const myCalendarQueryValidator = vine.compile(
  vine.object({
    dateFrom: isoDate(),
    dateTo: isoDate(),
  }),
)
