/**
 * v3-chart-gallery-data-foundation —— RequirementTask Model（W1.4）。
 *
 * 需求-任务双向关联记录（requirement_tasks）。
 * - UNIQUE(requirement_id, task_id) 防重复绑定
 * - 关联表物理级联删除（需求/任务任一删除即清绑定），不做软删除
 * - 组织隔离列 organization_id 与需求/任务同租户（绑定校验在服务层）
 */
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Requirement from './requirement.js'
import Task from './task.js'

export default class RequirementTask extends BaseModel {
  public static table = 'requirement_tasks'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare requirementId: number

  @column()
  declare taskId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ── 关联 ──
  @belongsTo(() => Requirement, { foreignKey: 'requirementId' })
  declare requirement: BelongsTo<typeof Requirement>

  @belongsTo(() => Task, { foreignKey: 'taskId' })
  declare task: BelongsTo<typeof Task>
}
