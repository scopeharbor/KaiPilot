import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * wiki_context_shadow_records（v3-llm-wiki-query-navigation）。组织隔离：所有查询必须附加 organization_id。
 * 只存统计与问题哈希，不存问题原文与主张内容。
 */
export default class WikiContextShadowRecord extends BaseModel {
  static table = 'wiki_context_shadow_records'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare actorUserId: number | null

  @column()
  declare queryHash: string

  @column()
  declare pagesCount: number

  @column()
  declare claimsCount: number

  @column()
  declare bytes: number

  @column()
  declare truncated: boolean

  @column()
  declare legacySourcesCount: number

  @column()
  declare legacyFactsCount: number

  @column()
  declare durationMs: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
