import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { WikiLintFindingKind, WikiLintFindingStatus } from '@aiproj/types'

/**
 * wiki_lint_findings（v3-llm-wiki-memory-foundation）。组织隔离：所有查询必须附加 organization_id。
 */
export default class WikiLintFinding extends BaseModel {
  static table = 'wiki_lint_findings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare spaceId: number

  @column()
  declare pageId: number | null

  @column()
  declare findingKind: WikiLintFindingKind

  @column()
  declare status: WikiLintFindingStatus

  @column()
  declare dedupeKey: string

  @column({
    columnName: 'detail_json',
    prepare: (v: Record<string, string | number> | null) =>
      v === null || v === undefined ? null : JSON.stringify(v),
    // SQLite 返回字符串；PostgreSQL 的 json 驱动已解析
    consume: (v: unknown) =>
      v === null || v === undefined
        ? null
        : ((typeof v === 'string' ? JSON.parse(v) : v) as Record<string, string | number>),
  })
  declare detail: Record<string, string | number> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
