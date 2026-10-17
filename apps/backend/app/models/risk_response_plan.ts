import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Risk from './risk.js'
import Task from './task.js'
import User from './user.js'
import Project from './project.js'

export default class RiskResponsePlan extends BaseModel {
  static table = 'risk_response_plans'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare riskId: number

  @column()
  declare strategyType: string

  @column()
  declare actionDescription: string

  @column()
  declare ownerId: number | null

  @column.date()
  declare targetDate: DateTime | null

  @column()
  declare status: string

  @column()
  declare relatedTaskId: number | null

  @column()
  declare completionEvidence: string | null

  @column.date()
  declare completedAt: DateTime | null

  @column()
  declare auditLogId: number | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Risk, { foreignKey: 'riskId' })
  declare risk: BelongsTo<typeof Risk>

  @belongsTo(() => Task, { foreignKey: 'relatedTaskId' })
  declare relatedTask: BelongsTo<typeof Task>

  @belongsTo(() => User, { foreignKey: 'ownerId' })
  declare owner: BelongsTo<typeof User>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof RiskResponsePlan>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof RiskResponsePlan>) {
    query.whereNull('deleted_at')
  }
}
