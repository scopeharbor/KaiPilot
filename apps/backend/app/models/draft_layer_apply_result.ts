/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerApplyResult Model（task 2.5）。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import DraftLayerSession from './draft_layer_session.js'
import type {
  DraftLayerApplyStatus,
  DraftLayerApplyEntityCounts,
  DraftLayerApplyEntityReceipt,
} from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class DraftLayerApplyResult extends BaseModel {
  public static table = 'ai_draft_layer_apply_results'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionId: number

  @column()
  declare applyPlanHash: string

  @column()
  declare selectionHash: string

  @column()
  declare status: DraftLayerApplyStatus

  @column()
  declare projectId: number | null

  @column(jsonColumn)
  declare entityCounts: DraftLayerApplyEntityCounts | null

  /**
   * v3-triz-to-delivery-closed-loop —— typed entity receipt（task 4.1）。
   * nullable JSON；历史行为 null（legacy_unlinked）。
   */
  @column(jsonColumn)
  declare entityRefs: DraftLayerApplyEntityReceipt[] | null

  @column()
  declare errorSummary: string | null

  @column()
  declare idempotencyKey: string

  @column.dateTime()
  declare appliedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => DraftLayerSession, { foreignKey: 'sessionId' })
  declare session: BelongsTo<typeof DraftLayerSession>
}
