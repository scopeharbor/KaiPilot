import vine from '@vinejs/vine'

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * 日历快速新建的 AI 补全：日历上选的日期 + 原地输入（可空）。
 * 带 check 时只重算冲突（用户在小卡片上改过之后），不调用模型。
 */
export const calendarQuickCreateValidator = vine.compile(
  vine.object({
    startDate: isoDate(),
    endDate: isoDate().optional(),
    text: vine.string().trim().maxLength(1000).optional(),
    /** false：只要规则补全（双击后先秒出一张卡，再等 AI）。 */
    ai: vine.boolean().optional(),
    connectionId: vine.number().withoutDecimals().positive().optional(),
    modelId: vine.number().withoutDecimals().positive().optional(),
    check: vine
      .array(
        vine.object({
          name: vine.string().trim().maxLength(255),
          startDate: isoDate(),
          endDate: isoDate(),
          assigneeId: vine.number().withoutDecimals().positive().nullable(),
        }),
      )
      .maxLength(8)
      .optional(),
  }),
)
