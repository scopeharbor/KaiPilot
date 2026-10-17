import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import type {
  OcrDocumentJobStatus,
  OcrDocumentSourceKind,
  OcrDocumentWarningCode,
  OcrDocumentWarning,
  OcrDocumentCostSummary,
} from '@aiproj/types'
import OcrDocumentPage from '#models/ocr_document_page'
import OcrDocumentExtraction from '#models/ocr_document_extraction'

export default class OcrDocumentJob extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare sourceAttachmentId: number | null

  @column()
  declare sourceKind: OcrDocumentSourceKind

  @column()
  declare sourceFileName: string | null

  @column()
  declare sourceMimeType: string | null

  @column()
  declare sourceHash: string

  @column()
  declare status: OcrDocumentJobStatus

  @column()
  declare pageCount: number

  @column()
  declare succeededPages: number

  @column()
  declare failedPages: number

  @column()
  declare idempotencyKeyHash: string | null

  @column()
  declare inputSignature: string | null

  @column()
  declare connectionId: number | null

  @column()
  declare modelId: number | null

  @column()
  declare provider: string | null

  @column()
  declare model: string | null

  @column()
  declare promptHint: string | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warningCodes: OcrDocumentWarningCode[] | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warnings: OcrDocumentWarning[] | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare costSummary: OcrDocumentCostSummary | null

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // ── 保留生命周期元数据（v3-ocr-result-persistence-and-retention §3.5） ──
  @column()
  declare retentionLifecycle: string | null

  @column()
  declare retentionSensitivity: string | null

  @column.dateTime()
  declare retentionEligibleAt: DateTime | null

  @column.dateTime()
  declare purgedAt: DateTime | null

  @column.dateTime()
  declare redactedAt: DateTime | null

  @column()
  declare tombstoneId: number | null

  @column()
  declare retentionPolicyHash: string | null

  @hasMany(() => OcrDocumentPage, { foreignKey: 'jobId' })
  declare pages: HasMany<typeof OcrDocumentPage>

  @hasMany(() => OcrDocumentExtraction, { foreignKey: 'jobId' })
  declare extractions: HasMany<typeof OcrDocumentExtraction>
}
