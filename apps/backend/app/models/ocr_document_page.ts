import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrDocumentPageStatus,
  OcrDocumentWarning,
  OcrDocumentProviderUsage,
} from '@aiproj/types'
import OcrDocumentJob from '#models/ocr_document_job'

export default class OcrDocumentPage extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare jobId: number

  @column()
  declare pageIndex: number

  @column()
  declare sourceHash: string

  @column()
  declare status: OcrDocumentPageStatus

  @column()
  declare mimeType: string | null

  @column()
  declare normalizedBytes: number | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warnings: OcrDocumentWarning[] | null

  @column()
  declare candidateId: number | null

  @column()
  declare candidateText: string | null

  @column()
  declare candidateHash: string | null

  @column()
  declare provider: string | null

  @column()
  declare model: string | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare usage: OcrDocumentProviderUsage | null

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

  @belongsTo(() => OcrDocumentJob, { foreignKey: 'jobId' })
  declare job: BelongsTo<typeof OcrDocumentJob>
}
