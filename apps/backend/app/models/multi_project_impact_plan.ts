import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'

export default class MultiProjectImpactPlan extends BaseModel {
  static table = 'multi_project_impact_plans'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare actorId: number

  @column()
  declare runToken: string

  @column()
  declare scopeHash: string

  @column()
  declare ruleVersion: string

  @column()
  declare sourceFreshnessHash: string

  @column()
  declare permissionFingerprint: string

  @column()
  declare scopeJson: string

  @column.dateTime({ autoCreate: false })
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization, {
    foreignKey: 'organizationId',
    localKey: 'id',
  })
  declare organization: BelongsTo<typeof Organization>
}
