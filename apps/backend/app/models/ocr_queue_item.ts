import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrQueueItemStatus,
  OcrQueueWorkKind,
  OcrQueueFailureCategory,
  OcrBatchWarningCode,
  OcrBatchWarning,
} from '@aiproj/types'
import OcrDocumentBatch from '#models/ocr_document_batch'
import OcrDocumentJob from '#models/ocr_document_job'

export default class OcrQueueItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare batchId: number

  @column()
  declare jobId: number

  @column()
  declare pageId: number | null

  // Dispatch metadata
  @column()
  declare workKind: OcrQueueWorkKind

  @column()
  declare priority: number

  @column()
  declare status: OcrQueueItemStatus

  // Attempt tracking
  @column()
  declare attemptCount: number

  @column()
  declare maxAttempts: number

  @column.dateTime()
  declare nextAttemptAt: DateTime | null

  @column.dateTime()
  declare retryAfter: DateTime | null

  // Locking
  @column()
  declare lockOwner: string | null

  @column.dateTime()
  declare lockedAt: DateTime | null

  // Source & model
  @column()
  declare sourceHash: string

  @column()
  declare provider: string | null

  @column()
  declare model: string | null

  @column()
  declare connectionId: number | null

  @column()
  declare modelId: number | null

  // Failure / warnings
  @column()
  declare failureCategory: OcrQueueFailureCategory

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warningCodes: OcrBatchWarningCode[] | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warnings: OcrBatchWarning[] | null

  // Idempotency
  @column()
  declare idempotencyKeyHash: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => OcrDocumentBatch, { foreignKey: 'batchId' })
  declare batch: BelongsTo<typeof OcrDocumentBatch>

  @belongsTo(() => OcrDocumentJob, { foreignKey: 'jobId' })
  declare job: BelongsTo<typeof OcrDocumentJob>

  /**
   * Project-scoped query helper.
   */
  static forProject(organizationId: number, projectId: number) {
    return this.query().where('organization_id', organizationId).where('project_id', projectId)
  }

  /**
   * Due items query: items that are queued and ready (nextAttemptAt is null or passed).
   */
  static due(organizationId: number, projectId: number) {
    return this.forProject(organizationId, projectId)
      .where('status', 'queued')
      .where((q) => {
        q.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', DateTime.utc().toSQL()!)
      })
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'asc')
  }
}
