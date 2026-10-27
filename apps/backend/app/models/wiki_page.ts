import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiPageType } from '@aiproj/types'

/**
 * wiki_pages（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiPage extends BaseModel {
  static table = 'wiki_pages'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare spaceId: number

  @column()
  declare slug: string

  @column()
  declare pageType: WikiPageType

  @column()
  declare title: string

  @column()
  declare summaryLine: string

  @column()
  declare status: 'active' | 'archived'

  @column()
  declare ownerUserId: number | null

  /** 只能由 WikiRevisionService.publish 写入。 */
  @column()
  declare publishedRevisionId: number | null

  @column()
  declare sensitivity: 'normal' | 'restricted'

  @column()
  declare staleAfterDays: number | null

  @column({
    columnName: 'shared_with_project_ids_json',
    prepare: (v: number[] | null) => (v === null || v === undefined ? null : JSON.stringify(v)),
    // SQLite 返回字符串；PostgreSQL 的 json 驱动已解析
    consume: (v: unknown) =>
      v === null || v === undefined
        ? null
        : ((typeof v === 'string' ? JSON.parse(v) : v) as number[]),
  })
  declare sharedWithProjectIds: number[] | null

  @column.dateTime()
  declare lastPublishedAt: DateTime | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
