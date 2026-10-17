import Project from './project.js'
import Resource from './resource.js'
import User from './user.js'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

export type ResourceAvailabilityExceptionStatus = 'planned' | 'confirmed' | 'cancelled'

export default class ResourceAvailabilityException extends BaseModel {
  public static table = 'resource_availability_exceptions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare resourceId: number

  @column.date()
  declare startDate: DateTime

  @column.date()
  declare endDate: DateTime

  @column()
  declare capacityOverrideHours: number

  @column()
  declare reason: string

  @column()
  declare status: ResourceAvailabilityExceptionStatus

  @column()
  declare auditLogId: number | null

  @column()
  declare createdBy: number | null

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
