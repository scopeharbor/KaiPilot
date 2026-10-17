import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import User from './user.js'
import type { DetectionRunStatus, DetectionSeverity, DetectionWarningCode } from '@aiproj/types'

export default class MultiProjectDependencyDetectionRun extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare actorId: number

  @column()
  declare planToken: string

  @column()
  declare scopeHash: string

  @column()
  declare ruleSetKey: string

  @column()
  declare sourceFreshnessHash: string

  @column()
  declare status: DetectionRunStatus

  @column()
  declare resultCount: number

  @column({
    prepare: (value: Record<DetectionSeverity, number> | null) =>
      value ? JSON.stringify(value) : null,
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare resultSummary: Record<DetectionSeverity, number> | null

  @column({
    prepare: (value: DetectionWarningCode[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare warnings: DetectionWarningCode[] | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
