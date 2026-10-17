import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * attachment_versions 表：不可变物理版本记录（D2）。
 * 每次上传新版本创建新记录；回滚是将历史版本内容复制为新版本。
 */
export default class extends BaseSchema {
  protected tableName = 'attachment_versions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('attachment_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('attachments')
        .onDelete('CASCADE')

      // 版本号（从 1 开始递增）
      table.integer('version_no').unsigned().notNullable()

      // 存储路径（相对于 UPLOAD_ROOT）
      table.string('storage_path', 500).notNullable()

      // 文件元数据
      table.bigInteger('file_size').unsigned().notNullable().defaultTo(0)
      table.string('mime_type', 127).nullable()
      table.string('file_name', 255).notNullable()

      // SHA-256 checksum
      table.string('checksum_sha256', 64).nullable()

      // 版本说明
      table.string('change_note', 500).nullable()

      // 创建者
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()

      // 索引
      table.index(['attachment_id', 'version_no'], 'idx_attachment_versions_no')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
