import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * 文件搜索索引模型（D4）。
 * 轻量搜索索引，保存文件名、标签、文本摘要和实体引用，
 * 支持 SQLite LIKE 查询。
 */
export default class FileSearchEntry extends BaseModel {
  declare static table: string

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fileType: string // 'attachment' | 'document'

  @column()
  declare fileId: number

  @column()
  declare projectId: number

  @column()
  declare organizationId: number

  @column()
  declare fileName: string

  @column()
  declare mimeType: string | null

  @column()
  declare uploaderName: string | null

  @column()
  declare tagsText: string | null

  @column()
  declare entityRefs: string | null

  @column()
  declare contentSnippet: string | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}

FileSearchEntry.table = 'file_search_entries'
