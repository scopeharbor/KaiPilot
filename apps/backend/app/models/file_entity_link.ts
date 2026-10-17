import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * 文件实体关联模型（D5）。
 * 链接附件/文档到项目实体（task/milestone/risk 等），
 * 含组织和项目隔离校验。
 */
export default class FileEntityLink extends BaseModel {
  declare static table: string

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fileType: string // 'attachment' | 'document'

  @column()
  declare fileId: number

  @column()
  declare entityType: string // 白名单实体类型

  @column()
  declare entityId: number

  @column()
  declare linkType: string // 'related' | 'reference' | 'attachment'

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}

FileEntityLink.table = 'file_entity_links'
