import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { ProjectDraftEventType, ProjectDraftStreamEvent } from '@aiproj/types'
import AiProjectDraft from './ai_project_draft.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

/**
 * AiProjectDraftEvent —— SSE 事件持久化（design D4）。
 * 按 (draft_id, sequence) 唯一，支持 Last-Event-ID 幂等恢复；payload 存完整事件（无 rawInput）。
 */
export default class AiProjectDraftEvent extends BaseModel {
  public static table = 'ai_project_draft_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare draftId: number

  @column()
  declare sequence: number

  @column()
  declare version: number

  @column()
  declare type: ProjectDraftEventType

  @column(jsonColumn)
  declare payload: ProjectDraftStreamEvent

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => AiProjectDraft, { foreignKey: 'draftId' })
  declare draftSession: BelongsTo<typeof AiProjectDraft>
}
