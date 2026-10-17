import Project from './project.js'
import User from './user.js'
import Task from './task.js'
import RiskResponsePlan from './risk_response_plan.js'
import RiskHistory from './risk_history.js'
import { beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'

export default class Risk extends BaseModel {
  static table = 'risks'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare riskCode: string | null

  @column()
  declare title: string

  @column()
  declare description: string

  @column()
  declare category: string

  @column()
  declare probability: number

  @column()
  declare impact: number

  @column()
  declare score: number

  @column()
  declare status: string

  @column()
  declare mitigationStrategy: string | null

  @column()
  declare contingencyPlan: string | null

  @column()
  declare ownerId: number | null

  @column()
  declare triggerEvent: string | null

  @column()
  declare residualProbability: number | null

  @column()
  declare residualImpact: number | null

  @column()
  declare residualScore: number | null

  // V2 扩展字段
  @column()
  declare riskLevel: string

  @column()
  declare priority: string

  @column()
  declare triggerCondition: string | null

  @column.date()
  declare nextReviewAt: DateTime | null

  @column.date()
  declare lastReviewAt: DateTime | null

  @column()
  declare closedReason: string | null

  @column()
  declare closedNotes: string | null

  @column.date()
  declare identifiedAt: DateTime

  @column.date()
  declare targetResolutionDate: DateTime | null

  @column.date()
  declare resolvedAt: DateTime | null

  @column()
  declare relatedTaskId: number | null

  @column()
  declare aiMetadata: string | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关联
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'ownerId' })
  declare owner: BelongsTo<typeof User>

  @belongsTo(() => Task, { foreignKey: 'relatedTaskId' })
  declare relatedTask: BelongsTo<typeof Task>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  // V2 关联
  @hasMany(() => RiskResponsePlan, { foreignKey: 'riskId' })
  declare responsePlans: HasMany<typeof RiskResponsePlan>

  @hasMany(() => RiskHistory, { foreignKey: 'riskId' })
  declare histories: HasMany<typeof RiskHistory>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Risk>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Risk>) {
    query.whereNull('deleted_at')
  }
}
