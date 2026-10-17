import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OkrObjective from './okr_objective.js'

export default class OkrAlignment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare childObjectiveId: number

  @column()
  declare parentObjectiveId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => OkrObjective, { foreignKey: 'childObjectiveId' })
  declare childObjective: BelongsTo<typeof OkrObjective>

  @belongsTo(() => OkrObjective, { foreignKey: 'parentObjectiveId' })
  declare parentObjective: BelongsTo<typeof OkrObjective>

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrAlignment>) {
    query.whereNull('deleted_at')
  }
}
