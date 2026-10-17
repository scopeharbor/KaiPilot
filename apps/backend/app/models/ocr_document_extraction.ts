import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrDocumentExtractionStatus } from '@aiproj/types'
import OcrDocumentJob from '#models/ocr_document_job'

export default class OcrDocumentExtraction extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare jobId: number

  @column()
  declare sourceAttachmentId: number | null

  @column()
  declare acceptedText: string

  @column()
  declare acceptedTextHash: string

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare pageRefs: number[] | null

  @column()
  declare sourceHash: string

  @column()
  declare reviewerId: number

  @column()
  declare reviewNote: string | null

  @column()
  declare status: OcrDocumentExtractionStatus

  @column()
  declare supersededById: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => OcrDocumentJob, { foreignKey: 'jobId' })
  declare job: BelongsTo<typeof OcrDocumentJob>
}
