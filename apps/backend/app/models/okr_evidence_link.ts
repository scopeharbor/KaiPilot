import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

export default class OkrEvidenceLink extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare targetType: string

  @column()
  declare targetId: number

  @column()
  declare sourceKind: string

  @column()
  declare sourceId: number

  @column()
  declare summary: string

  @column()
  declare hash: string

  @column.dateTime()
  declare lastSeenAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrEvidenceLink>) {
    query.whereNull('deleted_at')
  }
}
