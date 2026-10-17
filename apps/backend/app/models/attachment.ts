import { AttachmentSchema } from '#database/schema'
import { DateTime } from 'luxon'
import { belongsTo, hasMany, column } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'
import AttachmentVersion from './attachment_version.js'

/**
 * 附件模型：文件物理元数据，支持多态关联（entity_type/entity_id）。
 * V2 扩展：版本追踪（currentVersion）、回收站（deletedAt/deletedBy/deleteReason）。
 */
export default class Attachment extends AttachmentSchema {
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'uploadedBy' })
  declare uploader: BelongsTo<typeof User>

  // V2 版本追踪
  @column()
  declare currentVersion: number

  // V2 回收站
  @column.dateTime()
  declare deletedAt: DateTime | null

  @column()
  declare deletedBy: number | null

  @column()
  declare deleteReason: string | null

  // V2 关系
  @hasMany(() => AttachmentVersion, { foreignKey: 'attachmentId' })
  declare versions: HasMany<typeof AttachmentVersion>

  /**
   * 软删除过滤器：默认排除回收站中的附件。
   */
  static excludeSoftDeleted(query: any) {
    query.whereNull('deleted_at')
  }

  /**
   * 是否在回收站中。
   */
  get isTrashed(): boolean {
    return this.deletedAt !== null
  }
}
