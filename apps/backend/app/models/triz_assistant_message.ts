import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizAssistantRun from './triz_assistant_run.js'
import type { AiTrizAssistantMessageRole } from '@aiproj/types'

/**
 * AI-TRIZ 助手消息模型（v3-ai-triz-assistant §3.2）。
 *
 * 每条消息属于一个 assistant run，只存低敏内容摘要。
 */
export default class TrizAssistantMessage extends BaseModel {
  static table = 'triz_assistant_messages'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare runDbId: number

  @column()
  declare runId: string

  @column()
  declare messageId: string

  @column()
  declare role: AiTrizAssistantMessageRole

  @column()
  declare contentSummary: string

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceRefsJson: string[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // 关系
  @belongsTo(() => TrizAssistantRun, { foreignKey: 'runDbId' })
  declare run: BelongsTo<typeof TrizAssistantRun>
}
