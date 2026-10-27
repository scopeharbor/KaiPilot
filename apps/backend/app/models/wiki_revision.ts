import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiAuthorKind, WikiEditClass, WikiRevisionStatus } from '@aiproj/types'

/**
 * wiki_revisions（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiRevision extends BaseModel {
  static table = 'wiki_revisions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare pageId: number

  @column()
  declare baseRevisionId: number | null

  @column()
  declare bodyMarkdown: string

  @column()
  declare authorKind: WikiAuthorKind

  @column()
  declare authorUserId: number | null

  @column()
  declare editClass: WikiEditClass

  /** 只能由 WikiRevisionService.publish 置为 published。 */
  @column()
  declare status: WikiRevisionStatus

  @column()
  declare changeSummary: string

  @column()
  declare contentHash: string

  @column()
  declare reviewedBy: number | null

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column()
  declare rejectReason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
