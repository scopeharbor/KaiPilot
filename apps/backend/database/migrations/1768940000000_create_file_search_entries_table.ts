import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * file_search_entries 表：轻量搜索索引（D4）。
 * 保存文件名、标签、上传者、文本摘要和实体引用，支持 SQLite LIKE 查询。
 */
export default class extends BaseSchema {
  protected tableName = 'file_search_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 文件类型：attachment / document
      table.string('file_type', 20).notNullable()
      table.bigInteger('file_id').unsigned().notNullable()

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 索引字段
      table.string('file_name', 255).notNullable()
      table.string('mime_type', 127).nullable()
      table.string('uploader_name', 100).nullable()
      table.text('tags_text', 'longtext').nullable() // 逗号分隔的标签名
      table.text('entity_refs', 'longtext').nullable() // 关联实体摘要文本
      table.text('content_snippet', 'longtext').nullable() // 文件内容摘要（仅文本类文件）

      table.timestamp('updated_at').nullable()
      table.timestamp('created_at').notNullable()

      // 唯一约束
      table.unique(['file_type', 'file_id'], 'idx_search_entries_file')

      // 索引
      table.index(['project_id'])
      table.index(['file_name'])
      table.index(['organization_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
