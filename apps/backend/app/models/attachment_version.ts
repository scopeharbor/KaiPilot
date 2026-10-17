import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Attachment from './attachment.js'
import User from './user.js'

/**
 * 附件版本模型：不可变物理版本记录（D2）。
 */
export default class AttachmentVersion extends BaseModel {
  declare static table: string

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare attachmentId: number

  @column()
  declare versionNo: number

  @column()
  declare storagePath: string

  @column()
  declare fileSize: number

  @column()
  declare mimeType: string | null

  @column()
  declare fileName: string

  @column()
  declare checksumSha256: string | null

  @column()
  declare changeNote: string | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // 关系
  @belongsTo(() => Attachment, { foreignKey: 'attachmentId' })
  declare attachment: BelongsTo<typeof Attachment>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  // 序列化时隐藏存储路径
  serialize() {
    const data = super.serialize()
    delete data.storagePath
    return data
  }
}

AttachmentVersion.table = 'attachment_versions'
