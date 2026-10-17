import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * V3 图表馆基线成本快照契约（W1.5 升级）：
 * - 任务节点固化 `baselineCostCents`（打基线时从任务 cost_estimate_cents 抽取）
 * - 根结构保存 `totalBaselineCostCents`（EVM BAC 取数来源）
 * - 旧快照（2026-09 前保存）缺省这两个字段，读取方按 0 回退（EVM 有降级路径）
 */
export interface GanttBaselineSnapshot {
  tasks: Array<{
    id: number
    startDate: string | null
    endDate: string | null
    baselineCostCents: number
  }>
  milestones: Array<{ id: number; plannedDate: string | null }>
  savedAt: string
  totalBaselineCostCents: number
}

/** 每项目唯一的 V1 甘特基线。再次保存覆盖同一行，不累积历史。 */
export default class GanttBaseline extends BaseModel {
  static table = 'gantt_baselines'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare projectId: number

  @column({
    prepare: (value: GanttBaselineSnapshot) => JSON.stringify(value),
    consume: (value: string | GanttBaselineSnapshot) =>
      typeof value === 'string' ? JSON.parse(value) : value,
    serialize: (value: GanttBaselineSnapshot) => value,
  })
  declare snapshot: GanttBaselineSnapshot

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
