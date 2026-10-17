import Project from './project.js'
import User from './user.js'
import ResourceAllocation from './resource_allocation.js'
import ResourceAvailabilityException from './resource_availability_exception.js'
import ResourceCapacityVersion from './resource_capacity_version.js'
import { beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'

export default class Resource extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare projectId: number

  @column()
  declare userId: number | null

  @column()
  declare name: string

  @column()
  declare email: string | null

  @column()
  declare resourceType: string

  @column()
  declare role: string

  @column()
  declare status: string

  @column()
  declare capacityVersion: number

  @column()
  declare capacityCalendarPolicy: string

  @column()
  declare dailyCapacityHours: number

  @column()
  declare skillTags: string | null

  @column()
  declare roleTags: string

  @column()
  declare capacityProfile: string | null

  @column()
  declare workDays: string

  @column()
  declare timezone: string

  @column()
  declare costPerUnitCents: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @hasMany(() => ResourceAllocation, { foreignKey: 'resourceId' })
  declare allocations: HasMany<typeof ResourceAllocation>

  @hasMany(() => ResourceAvailabilityException, { foreignKey: 'resourceId' })
  declare availabilityExceptions: HasMany<typeof ResourceAvailabilityException>

  @hasMany(() => ResourceCapacityVersion, { foreignKey: 'resourceId' })
  declare capacityVersions: HasMany<typeof ResourceCapacityVersion>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Resource>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Resource>) {
    query.whereNull('deleted_at')
  }
}
