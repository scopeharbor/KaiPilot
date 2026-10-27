import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiScopeKind } from '@aiproj/types'

/**
 * wiki_spaces（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiSpace extends BaseModel {
  static table = 'wiki_spaces'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare scopeKind: WikiScopeKind

  @column()
  declare scopeRefId: number

  @column()
  declare title: string

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
