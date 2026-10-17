import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import type {
  OcrBatchStatus,
  OcrBatchAggregateStatus,
  OcrBatchWarningCode,
  OcrBatchWarning,
  OcrBatchCostSummary,
} from '@aiproj/types'
import OcrDocumentBatchSource from '#models/ocr_document_batch_source'
import OcrQueueItem from '#models/ocr_queue_item'

export default class OcrDocumentBatch extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare createdBy: number

  // Source snapshot
  @column()
  declare sourceCount: number

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare sourceIdsJson: number[] | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare sourceHashesJson: Record<string, string>[] | null

  // Model / options
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

  @column()
  declare pageLimit: number | null

  // Status & progress
  @column()
  declare status: OcrBatchStatus

  @column()
  declare aggregateStatus: OcrBatchAggregateStatus | null

  @column()
  declare completedCount: number

  @column()
  declare failedCount: number

  @column()
  declare cancelledCount: number

  @column()
  declare queuedCount: number

  @column()
  declare processingCount: number

  // Idempotency
  @column()
  declare idempotencyKeyHash: string | null

  @column()
  declare inputSignature: string | null

  // Warnings / cost
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

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare costSummary: OcrBatchCostSummary | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => OcrDocumentBatchSource, { foreignKey: 'batchId' })
  declare sources: HasMany<typeof OcrDocumentBatchSource>

  @hasMany(() => OcrQueueItem, { foreignKey: 'batchId' })
  declare queueItems: HasMany<typeof OcrQueueItem>

  /**
   * Project-scoped query helper.
   */
  static forProject(organizationId: number, projectId: number) {
    return this.query().where('organization_id', organizationId).where('project_id', projectId)
  }
}
