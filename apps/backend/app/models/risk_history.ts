import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Risk from './risk.js'
import User from './user.js'

export default class RiskHistory extends BaseModel {
  static table = 'risk_histories'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare riskId: number

  @column()
  declare eventType: string

  @column()
  declare actorId: number | null

  @column()
  declare summary: Record<string, unknown> | null

  @column()
  declare sourceType: string

  @column()
  declare sourceRef: string | null

  @column.dateTime()
  declare occurredAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Risk, { foreignKey: 'riskId' })
  declare risk: BelongsTo<typeof Risk>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
