import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * v2-ai-smart-recommendations — ProjectRecommendationEvent model.
 * Lightweight event history for recommendation state transitions.
 */
export default class ProjectRecommendationEvent extends BaseModel {
  static table = 'project_recommendation_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare recommendationId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare eventType: string

  @column()
  declare fromStatus: string | null

  @column()
  declare toStatus: string | null

  @column()
  declare actorId: number

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) =>
      value ? (JSON.parse(value) as Record<string, unknown>) : null,
  })
  declare metadata: Record<string, unknown> | null

  @column()
  declare summary: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
