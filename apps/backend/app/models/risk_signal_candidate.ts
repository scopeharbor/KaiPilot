import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Risk from './risk.js'
import User from './user.js'
import Project from './project.js'

export default class RiskSignalCandidate extends BaseModel {
  static table = 'risk_signal_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare ruleId: string

  @column()
  declare ruleVersion: string

  @column()
  declare severity: string

  /**
   * JSON 列：SQLite 不支持原生 JSON 绑定，
   * 需要 prepare/consume 进行序列化/反序列化。
   */
  @column({
    prepare: (value: unknown) => JSON.stringify(value),
    consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare evidence: Record<string, unknown>[]

  @column()
  declare recommendedAction: string

  @column()
  declare confidence: number

  @column()
  declare source: string

  @column()
  declare templateId: number | null

  @column()
  declare idempotencyKey: string

  @column.dateTime()
  declare expiresAt: DateTime

  @column()
  declare status: string

  @column()
  declare resolvedBy: number | null

  @column.dateTime()
  declare resolvedAt: DateTime | null

  @column()
  declare acceptedRiskId: number | null

  @column()
  declare auditLogId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Risk, { foreignKey: 'acceptedRiskId' })
  declare acceptedRisk: BelongsTo<typeof Risk>

  @belongsTo(() => User, { foreignKey: 'resolvedBy' })
  declare resolver: BelongsTo<typeof User>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>
}
