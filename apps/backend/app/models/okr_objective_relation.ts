import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OkrObjective from './okr_objective.js'

export default class OkrObjectiveRelation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare sourceObjectiveId: number

  @column()
  declare targetObjectiveId: number

  @column()
  declare relationType: string

  @column()
  declare status: string

  @column()
  declare impactWeight: number

  @column()
  declare reasonCode: string | null

  @column()
  declare evidenceRefHash: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => OkrObjective, { foreignKey: 'sourceObjectiveId' })
  declare sourceObjective: BelongsTo<typeof OkrObjective>

  @belongsTo(() => OkrObjective, { foreignKey: 'targetObjectiveId' })
  declare targetObjective: BelongsTo<typeof OkrObjective>

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrObjectiveRelation>) {
    query.whereNull('deleted_at')
  }
}
