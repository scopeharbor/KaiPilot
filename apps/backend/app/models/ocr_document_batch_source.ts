import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrBatchWarningCode } from '@aiproj/types'
import OcrDocumentBatch from '#models/ocr_document_batch'

export default class OcrDocumentBatchSource extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare batchId: number

  @column()
  declare sourceIndex: number

  @column()
  declare sourceAttachmentId: number

  @column()
  declare sourceFileName: string | null

  @column()
  declare sourceMimeType: string | null

  @column()
  declare sourceHash: string

  @column()
  declare ocrJobId: number | null

  @column()
  declare status: string

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warningCodes: OcrBatchWarningCode[] | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => OcrDocumentBatch, { foreignKey: 'batchId' })
  declare batch: BelongsTo<typeof OcrDocumentBatch>
}
