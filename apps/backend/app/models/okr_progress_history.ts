import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OkrKeyResult from './okr_key_result.js'

export default class OkrProgressHistory extends BaseModel {
  static table = 'okr_progress_history'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare keyResultId: number

  @column()
  declare previousValue: number

  @column()
  declare newValue: number

  @column()
  declare source: string

  @column()
  declare confidence: string

  @column()
  declare note: string | null

  @column()
  declare evidenceRefs: string | null

  @column()
  declare recordedBy: number

  @column.dateTime()
  declare recordedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => OkrKeyResult, { foreignKey: 'keyResultId' })
  declare keyResult: BelongsTo<typeof OkrKeyResult>
}
