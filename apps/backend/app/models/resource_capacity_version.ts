import Project from './project.js'
import Resource from './resource.js'
import User from './user.js'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

export default class ResourceCapacityVersion extends BaseModel {
  public static table = 'resource_capacity_versions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare resourceId: number

  @column()
  declare version: number

  @column()
  declare baseDailyCapacityHours: number

  @column()
  declare calendarPolicy: string

  @column()
  declare workDays: string | null

  @column()
  declare skillTags: string | null

  @column()
  declare roleTags: string

  @column()
  declare status: string

  @column.date()
  declare effectiveFrom: DateTime | null

  @column.date()
  declare effectiveTo: DateTime | null

  @column()
  declare createdBy: number | null

  @column()
  declare auditLogId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Resource, { foreignKey: 'resourceId' })
  declare resource: BelongsTo<typeof Resource>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>
}
