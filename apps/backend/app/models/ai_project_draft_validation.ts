import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { DraftAutoFixDiff, DraftValidationReport } from '@aiproj/types'
import AiProjectDraft from './ai_project_draft.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class AiProjectDraftValidation extends BaseModel {
  public static table = 'ai_project_draft_validations'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare draftId: number

  @column()
  declare version: number

  @column()
  declare phase: 'self_checking' | 'validating' | 'all'

  @column()
  declare confidenceScore: number

  @column()
  declare overallRiskLevel: string

  @column()
  declare canConfirm: boolean

  @column(jsonColumn)
  declare report: DraftValidationReport

  @column(jsonColumn)
  declare autoFixDiffs: DraftAutoFixDiff[] | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => AiProjectDraft, { foreignKey: 'draftId' })
  declare draftSession: BelongsTo<typeof AiProjectDraft>
}
