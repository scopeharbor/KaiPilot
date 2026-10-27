import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * wiki_retractions（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiRetraction extends BaseModel {
  static table = 'wiki_retractions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare spaceId: number

  @column()
  declare claimFingerprint: string

  @column()
  declare reason: string

  @column()
  declare retractedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
