import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiSourceKind } from '@aiproj/types'

/**
 * wiki_claim_sources（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiClaimSource extends BaseModel {
  static table = 'wiki_claim_sources'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare claimId: number

  @column()
  declare sourceKind: WikiSourceKind

  @column()
  declare sourceId: string

  @column()
  declare sourceVersion: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
