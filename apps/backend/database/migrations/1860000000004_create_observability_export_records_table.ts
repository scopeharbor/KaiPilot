import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * observability_export_records 表：V3 导出审计记录。
 *
 * D8：导出只导出该组织自己的数据，且导出本身要审计。
 *
 * v3-observability-data-retention §7.4
 */
export default class extends BaseSchema {
  protected tableName = 'observability_export_records'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 作用域
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 操作人
      table
        .bigInteger('requested_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 导出内容
      table.json('data_classes_json').notNullable()
      table.integer('record_count').unsigned().notNullable().defaultTo(0)
      table.string('export_format', 10).notNullable().defaultTo('json')
      table.check("export_format IN ('json','csv')")

      // 完整性哈希
      table.string('export_hash', 64).notNullable()

      // 时间戳
      table.timestamp('exported_at').notNullable()
      table.timestamp('created_at').notNullable()

      // 索引
      table.index(['organization_id'], 'idx_oe_org')
      table.index(['organization_id', 'exported_at'], 'idx_oe_org_exported_at')
      table.index(['exported_at'], 'idx_oe_exported_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
