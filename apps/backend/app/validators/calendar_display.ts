import vine from '@vinejs/vine'
import { CALENDAR_SYSTEM_IDS } from '@aiproj/types'

/** 查询生效设定：可带项目（项目层参与解析）。 */
export const calendarDisplayQueryValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive().optional(),
  }),
)

/** 改某一层：systems 为有序曆法 id 列表；null 表示清除、改为继承上层。 */
export const calendarDisplayUpdateValidator = vine.compile(
  vine.object({
    layer: vine.enum(['personal', 'project', 'organization'] as const),
    projectId: vine.number().withoutDecimals().positive().optional(),
    systems: vine
      .array(vine.enum([...CALENDAR_SYSTEM_IDS]))
      .minLength(1)
      .maxLength(CALENDAR_SYSTEM_IDS.length)
      .nullable(),
  }),
)
