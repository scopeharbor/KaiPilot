import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import type { AiTrizAssistantFeedbackReason } from '@aiproj/types'

/**
 * AI-TRIZ 助手反馈模型（v3-ai-triz-assistant §3.2）。
 *
 * 只存低敏反馈原因和评论。
 */
export default class TrizAssistantFeedback extends BaseModel {
  static table = 'triz_assistant_feedback'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare feedbackId: string

  @column()
  declare runId: string

  @column()
  declare messageId: string

  @column()
  declare reason: AiTrizAssistantFeedbackReason

  @column()
  declare comment: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // 关系
  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
