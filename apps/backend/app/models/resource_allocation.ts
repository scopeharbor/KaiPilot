import Resource from './resource.js'
import Task from './task.js'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'

export default class ResourceAllocation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare resourceId: number

  @column()
  declare taskId: number

  @column()
  declare allocationType: string

  @column()
  declare allocationPercent: number

  @column.date()
  declare startDate: DateTime | null

  @column.date()
  declare endDate: DateTime | null

  @column()
  declare plannedUnits: number | null

  @column()
  declare actualUnits: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Resource, { foreignKey: 'resourceId' })
  declare resource: BelongsTo<typeof Resource>

  @belongsTo(() => Task, { foreignKey: 'taskId' })
  declare task: BelongsTo<typeof Task>
}
