import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'

/**
 * 文件标签模型：项目内标签字典（D1）。
 */
export default class FileTag extends BaseModel {
  declare static table: string

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare projectId: number

  @column()
  declare organizationId: number

  @column()
  declare name: string

  @column()
  declare color: string | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>
}

FileTag.table = 'file_tags'
