import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrSearchIndexEntryStatus } from '@aiproj/types'
import User from './user.js'

/**
 * OCR Document Search Index Entry 模型（v3-ocr-document-search-indexing §3.4）。
 *
 * 组织+项目双隔离。存储被显式确认索引的 OCR accepted extraction 的搜索文本。
 * 支持 active/inactive/tombstoned 生命周期。
 */
export default class OcrDocumentSearchIndexEntry extends BaseModel {
  static table = 'ocr_document_search_index_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare extractionId: number

  @column()
  declare sourceKind: 'attachment' | 'document' | 'unknown'

  @column()
  declare sourceId: number | null

  @column()
  declare sourceHash: string

  @column()
  declare selectedTextHash: string

  @column()
  declare indexContentHash: string

  @column({
    prepare: (v: number[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): number[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as number[]
    },
    serialize: (v: unknown) => v,
  })
  declare pageRefsJson: number[]

  @column()
  declare searchableText: string

  @column()
  declare searchableSnippet: string | null

  @column()
  declare status: OcrSearchIndexEntryStatus

  @column()
  declare indexedBy: number | null

  @column.dateTime()
  declare indexedAt: DateTime | null

  @column()
  declare tombstonedBy: number | null

  @column.dateTime()
  declare tombstonedAt: DateTime | null

  @column()
  declare lastRunId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => User, { foreignKey: 'indexedBy' })
  declare indexer: BelongsTo<typeof User>
}
