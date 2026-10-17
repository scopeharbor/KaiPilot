import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class RiskKnowledgeTemplate extends BaseModel {
  static table = 'risk_knowledge_templates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number | null

  @column()
  declare title: string

  @column()
  declare description: string

  @column()
  declare category: string

  @column()
  declare applicableProjectTypes: string[] | null

  @column()
  declare triggerConditions: Record<string, unknown> | null

  @column()
  declare suggestedProbability: number | null

  @column()
  declare suggestedImpact: number | null

  @column()
  declare suggestedResponse: Record<string, unknown> | null

  @column()
  declare source: string

  @column()
  declare isActive: boolean

  @column()
  declare templateType: string

  @column()
  declare createdBy: number | null

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof RiskKnowledgeTemplate>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof RiskKnowledgeTemplate>) {
    query.whereNull('deleted_at')
  }
}
