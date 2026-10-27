import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * wiki_links（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiLink extends BaseModel {
  static table = 'wiki_links'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare fromPageId: number

  @column()
  declare toPageId: number

  @column()
  declare linkKind: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
