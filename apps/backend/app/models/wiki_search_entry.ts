import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * wiki_search_entries（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiSearchEntry extends BaseModel {
  static table = 'wiki_search_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare spaceId: number

  @column()
  declare pageId: number

  @column()
  declare title: string

  @column()
  declare summaryLine: string

  /** 只存小标题，不存正文全文（有界检索投影）。 */
  @column()
  declare headingsText: string

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
