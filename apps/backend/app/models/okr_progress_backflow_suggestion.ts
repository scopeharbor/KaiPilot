import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OkrKeyResult from './okr_key_result.js'

export default class OkrProgressBackflowSuggestion extends BaseModel {
  static table = 'okr_progress_backflow_suggestions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare keyResultId: number

  @column()
  declare proposedValue: number

  @column()
  declare currentValue: number

  @column()
  declare delta: number

  @column()
  declare contributionsJson: string

  @column()
  declare confidence: string

  @column()
  declare status: string

  @column()
  declare warningsJson: string | null

  @column()
  declare suggestionHash: string

  @column()
  declare baseProgressVersion: string

  @column()
  declare freshnessJson: string

  @column.dateTime()
  declare calculatedAt: DateTime

  @column()
  declare reasonCode: string | null

  @column()
  declare reasonNote: string | null

  @column()
  declare actorId: number | null

  @column.dateTime()
  declare actionedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => OkrKeyResult)
  declare keyResult: BelongsTo<typeof OkrKeyResult>
}
