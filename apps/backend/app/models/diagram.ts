import Project from './project.js'
import User from './user.js'
import { beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'
import type { DiagramSpec, DiagramType } from '@aiproj/types'

export default class Diagram extends BaseModel {
  static table = 'diagrams'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare type: DiagramType

  @column()
  declare title: string

  @column({
    prepare: (value: DiagramSpec) => JSON.stringify(value),
    consume: (value: string | DiagramSpec) =>
      typeof value === 'string' ? JSON.parse(value) : value,
  })
  declare spec: DiagramSpec

  @column()
  declare sourceHash: string | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Diagram>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Diagram>) {
    query.whereNull('deleted_at')
  }
}
