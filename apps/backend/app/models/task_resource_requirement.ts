import Project from './project.js'
import Task from './task.js'
import User from './user.js'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

export type TaskResourceRequirementPriority = 'low' | 'medium' | 'high' | 'critical'
export type TaskResourceRequirementStatus = 'open' | 'matched' | 'fulfilled' | 'cancelled'

export default class TaskResourceRequirement extends BaseModel {
  public static table = 'task_resource_requirements'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare taskId: number

  @column()
  declare role: string

  @column()
  declare skillTags: string | null

  @column()
  declare allocationPercent: number | null

  @column()
  declare estimatedPersonDays: number | null

  @column.date()
  declare startDate: DateTime

  @column.date()
  declare endDate: DateTime

  @column()
  declare priority: TaskResourceRequirementPriority

  @column()
  declare status: TaskResourceRequirementStatus

  @column()
  declare sourceKind: string

  @column()
  declare sourceRef: string | null

  @column()
  declare auditLogId: number | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Task, { foreignKey: 'taskId' })
  declare task: BelongsTo<typeof Task>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>
}
