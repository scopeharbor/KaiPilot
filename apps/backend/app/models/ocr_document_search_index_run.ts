import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrSearchIndexRunType,
  OcrSearchIndexRunStatus,
  OcrSearchIndexWarningCode,
  OcrSearchIndexBlockedReason,
} from '@aiproj/types'
import User from './user.js'

/**
 * OCR Document Search Index Run 模型（v3-ocr-document-search-indexing §3.4）。
 *
 * 记录每次 index/reindex/unindex 运行的元数据。
 * warnings 和 blockedReasons 为 JSON 列。
 */
export default class OcrDocumentSearchIndexRun extends BaseModel {
  static table = 'ocr_document_search_index_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare runType: OcrSearchIndexRunType

  @column()
  declare status: OcrSearchIndexRunStatus

  @column()
  declare previewHash: string | null

  @column()
  declare idempotencyKeyHash: string | null

  @column()
  declare entryCount: number

  @column()
  declare blockedCount: number

  @column()
  declare warningCount: number

  @column({
    prepare: (v: OcrSearchIndexWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): OcrSearchIndexWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrSearchIndexWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningsJson: OcrSearchIndexWarningCode[]

  @column({
    prepare: (v: OcrSearchIndexBlockedReason[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): OcrSearchIndexBlockedReason[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrSearchIndexBlockedReason[]
    },
    serialize: (v: unknown) => v,
  })
  declare blockedReasonsJson: OcrSearchIndexBlockedReason[]

  @column()
  declare note: string | null

  @column()
  declare runBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => User, { foreignKey: 'runBy' })
  declare runner: BelongsTo<typeof User>
}
