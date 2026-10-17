/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerPreview Model（task 2.5）。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import DraftLayerSession from './draft_layer_session.js'
import type { DraftLayerPreviewValidation } from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class DraftLayerPreview extends BaseModel {
  public static table = 'ai_draft_layer_previews'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionId: number

  @column()
  declare version: number

  @column(jsonColumn)
  declare baselineSummary: Record<string, unknown> | null

  @column(jsonColumn)
  declare currentSummary: Record<string, unknown> | null

  @column()
  declare previewHash: string

  @column(jsonColumn)
  declare computedFromChangeIds: number[]

  @column(jsonColumn)
  declare validationSummary: DraftLayerPreviewValidation | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => DraftLayerSession, { foreignKey: 'sessionId' })
  declare session: BelongsTo<typeof DraftLayerSession>
}
