import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OkrProgressBackflowSuggestion from './okr_progress_backflow_suggestion.js'

export default class OkrProgressBackflowSourceSnapshot extends BaseModel {
  static table = 'okr_progress_backflow_source_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare suggestionId: number

  @column()
  declare sourceKind: string

  @column()
  declare sourceId: number

  @column()
  declare sourceOrganizationId: number

  @column()
  declare weight: number

  @column()
  declare progress: number

  @column.dateTime()
  declare sourceLastUpdatedAt: DateTime

  @column()
  declare restricted: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => OkrProgressBackflowSuggestion)
  declare suggestion: BelongsTo<typeof OkrProgressBackflowSuggestion>
}
