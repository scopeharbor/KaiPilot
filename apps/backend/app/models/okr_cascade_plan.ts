import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import OkrObjective from './okr_objective.js'
import OkrCycle from './okr_cycle.js'
import OkrCascadePlanItem from './okr_cascade_plan_item.js'

export default class OkrCascadePlan extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare sourceObjectiveId: number

  @column()
  declare cycleId: number

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare status: string

  @column()
  declare coverage: string

  @column()
  declare warnings: string | null

  @column()
  declare assumptions: string | null

  @column()
  declare sourceRefs: string | null

  @column()
  declare metricVersion: string

  @column()
  declare revisionHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => OkrObjective, { foreignKey: 'sourceObjectiveId' })
  declare sourceObjective: BelongsTo<typeof OkrObjective>

  @belongsTo(() => OkrCycle)
  declare cycle: BelongsTo<typeof OkrCycle>

  @hasMany(() => OkrCascadePlanItem, { foreignKey: 'planId' })
  declare items: HasMany<typeof OkrCascadePlanItem>

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrCascadePlan>) {
    query.whereNull('deleted_at')
  }
}
