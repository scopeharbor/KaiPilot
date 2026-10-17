import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import OkrObjective from './okr_objective.js'
import OkrProgressHistory from './okr_progress_history.js'
import OkrEvidenceLink from './okr_evidence_link.js'

export default class OkrKeyResult extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare objectiveId: number

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare measurementType: string

  @column()
  declare unitLabel: string | null

  @column()
  declare baselineValue: number

  @column()
  declare targetValue: number

  @column()
  declare currentValue: number

  @column()
  declare confidence: string

  @column()
  declare status: string

  @column()
  declare weight: number

  @column.dateTime()
  declare lastUpdatedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  // 外键属性是 objectiveId，Lucid 默认推导为 okrObjectiveId
  @belongsTo(() => OkrObjective, { foreignKey: 'objectiveId' })
  declare objective: BelongsTo<typeof OkrObjective>

  @hasMany(() => OkrProgressHistory, { foreignKey: 'keyResultId' })
  declare progressHistory: HasMany<typeof OkrProgressHistory>

  @hasMany(() => OkrEvidenceLink, { foreignKey: 'targetId' })
  declare evidenceLinks: HasMany<typeof OkrEvidenceLink>

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrKeyResult>) {
    query.whereNull('deleted_at')
  }
}
