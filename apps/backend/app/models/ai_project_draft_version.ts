import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { ProjectDraft, ProjectDraftMeta, DraftValidationReport } from '@aiproj/types'
import AiProjectDraft from './ai_project_draft.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

/**
 * AiProjectDraftVersion —— 草案版本快照（design D3/D4）。
 * 存派生的草案 JSON（AI 输出），不含 rawInput。origin 区分生成/自动修正/人工修改。
 */
export default class AiProjectDraftVersion extends BaseModel {
  public static table = 'ai_project_draft_versions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare draftId: number

  @column()
  declare version: number

  @column()
  declare origin: 'generated' | 'auto_fixed' | 'modified'

  @column()
  declare status: 'active' | 'superseded' | 'rejected'

  @column(jsonColumn)
  declare draft: ProjectDraft

  @column(jsonColumn)
  declare meta: ProjectDraftMeta | null

  @column(jsonColumn)
  declare validation: DraftValidationReport | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => AiProjectDraft, { foreignKey: 'draftId' })
  declare draftSession: BelongsTo<typeof AiProjectDraft>
}
