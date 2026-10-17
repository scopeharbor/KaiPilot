import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 为 attachments 表补充 V2 文件管理字段：
 * - 当前版本号（版本追踪）
 * - 回收站 tombstone（deleted_at / deleted_by / delete_reason）
 */
export default class extends BaseSchema {
  protected tableName = 'attachments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 当前版本号（V2 版本追踪），默认 1
      table.integer('current_version').notNullable().defaultTo(1)

      // 回收站 tombstone（D3）
      table.timestamp('deleted_at').nullable()
      table
        .bigInteger('deleted_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('delete_reason', 500).nullable()

      // 索引：回收站查询
      table.index(['deleted_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['deleted_at'])
      table.dropColumn('delete_reason')
      table.dropColumn('deleted_by')
      table.dropColumn('current_version')
    })
  }
}
