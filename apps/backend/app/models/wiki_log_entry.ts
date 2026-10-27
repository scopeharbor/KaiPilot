import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiAuthorKind, WikiLogOp } from '@aiproj/types'

/**
 * wiki_log_entries（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiLogEntry extends BaseModel {
  static table = 'wiki_log_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare spaceId: number

  @column()
  declare op: WikiLogOp

  @column()
  declare line: string

  @column()
  declare actorKind: WikiAuthorKind

  @column()
  declare actorUserId: number | null

  @column()
  declare refPageId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
