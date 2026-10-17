import { MilestoneSchema } from '#database/schema'
import Project from './project.js'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * 里程碑模型（基于自动生成的 MilestoneSchema 基类）。
 *
 * 复用 T003 已建的 `milestones` 表（design D1，无需新迁移）：
 * `project_id/name/description/status/planned_date/auto_calculated/display_order/timestamps`。
 * 关联性质、不软删除（design D6）；随项目级联删除由外键 ON DELETE CASCADE 保证。
 *
 * `auto_calculated` 布尔在 SQLite 以 0/1 存储，显式 prepare/consume 归一（对齐 WbsNode 布尔字段处理）。
 */
export default class Milestone extends MilestoneSchema {
  /** 是否由系统推导得出（非人工设定）；不覆盖人工确认态的标志位（design D1/D2）。 */
  @column({
    prepare: (value: boolean) => (value ? 1 : 0),
    consume: (value: boolean | number) => Boolean(value),
  })
  declare autoCalculated: boolean

  /** 所属项目。 */
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>
}
