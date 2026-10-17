/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerChange Model（task 2.5）。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import DraftLayerSession from './draft_layer_session.js'
import type {
  DraftLayerChangeOperation,
  DraftLayerChangeTarget,
  DraftLayerReviewStatus,
  DraftLayerChangeValidation,
} from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class DraftLayerChange extends BaseModel {
  public static table = 'ai_draft_layer_changes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionId: number

  @column()
  declare targetEntityType: string

  @column()
  declare targetEntityId: string

  @column()
  declare targetFieldPath: string | null

  @column()
  declare operation: DraftLayerChangeOperation

  @column(jsonColumn)
  declare value: unknown

  @column(jsonColumn)
  declare oldValue: unknown | null

  @column()
  declare reviewStatus: DraftLayerReviewStatus

  @column(jsonColumn)
  declare userModifiedValue: unknown | null

  @column()
  declare userNote: string | null

  @column()
  declare sequence: number

  @column(jsonColumn)
  declare dependsOn: number[]

  @column()
  declare confidence: number

  @column(jsonColumn)
  declare validationSummary: DraftLayerChangeValidation | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 获取结构化的 target 对象。 */
  get target(): DraftLayerChangeTarget {
    return {
      entityType: this.targetEntityType as DraftLayerChangeTarget['entityType'],
      entityId: this.targetEntityId,
      fieldPath: this.targetFieldPath,
    }
  }

  set target(value: DraftLayerChangeTarget) {
    this.targetEntityType = value.entityType
    this.targetEntityId = value.entityId
    this.targetFieldPath = value.fieldPath ?? null
  }

  @belongsTo(() => DraftLayerSession, { foreignKey: 'sessionId' })
  declare session: BelongsTo<typeof DraftLayerSession>
}
