import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * attachments 表：文件附件元数据（sec7.2.2）。
 * 物理文件 V1 存本地文件系统，V2 S3/MinIO。
 * - 多态 entity_type / entity_id
 * - project_id → projects ON DELETE CASCADE
 * - storage_provider：local / s3 / minio / oss（V1 仅 local）
 * - file_size 用 bigInteger（字节）
 * 不软删除——删除记录即同步删除物理文件（sec7.5）。
 */
export default class extends BaseSchema {
  protected tableName = 'attachments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 多态关联：task / milestone / risk / document / change_request / comment / project
      table.string('entity_type', 30).notNullable()
      table.bigInteger('entity_id').unsigned().notNullable()

      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 上传者
      table
        .bigInteger('uploaded_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.string('file_name', 255).notNullable()
      table.string('file_path', 500).notNullable()
      // bigInteger 字节
      table.bigInteger('file_size').notNullable().defaultTo(0)
      table.string('mime_type', 127).nullable()
      table.string('thumbnail_path', 500).nullable()

      // 存储提供方
      table.string('storage_provider', 20).notNullable().defaultTo('local')
      table.check("storage_provider IN ('local','s3','minio','oss')")

      // 注意：本表不含 deleted_at（删除记录同步删物理文件）
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：实体附件查询、项目附件列表（sec7.5）
      table.index(['entity_type', 'entity_id'])
      table.index(['project_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
