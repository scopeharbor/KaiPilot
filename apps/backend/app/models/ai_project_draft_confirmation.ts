import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { DraftConfirmMode } from '@aiproj/types'
import AiProjectDraft from './ai_project_draft.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

/**
 * AiProjectDraftConfirmation —— 确认导入记录（design D7）。
 * 只存选择/校验摘要与创建的正式 project_id，不存草案全文或输入原文。
 */
export default class AiProjectDraftConfirmation extends BaseModel {
  public static table = 'ai_project_draft_confirmations'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare draftId: number

  @column()
  declare version: number

  @column()
  declare mode: DraftConfirmMode

  @column(jsonColumn)
  declare selectionSummary: Record<string, unknown> | null

  @column(jsonColumn)
  declare validationSummary: Record<string, unknown> | null

  @column()
  declare projectId: number | null

  @column()
  declare confirmedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => AiProjectDraft, { foreignKey: 'draftId' })
  declare draftSession: BelongsTo<typeof AiProjectDraft>
}
