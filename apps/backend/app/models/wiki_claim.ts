import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiClaimKind, WikiClaimStatus } from '@aiproj/types'

/**
 * wiki_claims（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiClaim extends BaseModel {
  static table = 'wiki_claims'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare pageId: number

  @column()
  declare revisionId: number

  @column()
  declare claimKey: string

  @column()
  declare statement: string

  @column()
  declare fingerprint: string

  @column()
  declare claimKind: WikiClaimKind

  @column()
  declare status: WikiClaimStatus

  @column.dateTime()
  declare validFrom: DateTime | null

  @column.dateTime()
  declare validTo: DateTime | null

  @column.dateTime()
  declare recordedAt: DateTime

  @column.dateTime()
  declare supersededAt: DateTime | null

  @column()
  declare supersedesClaimId: number | null

  /** 确定性计数：支持该主张的独立来源数（不存模型自报置信度）。 */
  @column()
  declare evidenceCount: number

  @column()
  declare invalidReason: 'source_deleted' | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
