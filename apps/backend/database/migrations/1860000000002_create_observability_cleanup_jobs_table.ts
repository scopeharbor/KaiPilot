import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * observability_cleanup_jobs 表：V3 清理作业状态。
 *
 * D5：清理作业失败必须可见并可查。
 * 每个组织+数据类别一条记录。
 *
 * v3-observability-data-retention §5.1
 */
export default class extends BaseSchema {
  protected tableName = 'observability_cleanup_jobs'

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

      // 数据类别
      table.string('data_class', 50).notNullable()

      // 状态
      table.string('status', 20).notNullable().defaultTo('idle')
      table.check("status IN ('idle','running','completed','failed')")

      // 执行统计
      table.timestamp('last_run_at').nullable()
      table.integer('last_run_duration_ms').unsigned().nullable()
      table.bigInteger('records_processed_total').unsigned().notNullable().defaultTo(0)
      table.bigInteger('records_failed_total').unsigned().notNullable().defaultTo(0)
      table.integer('consecutive_failures').unsigned().notNullable().defaultTo(0)

      // 失败原因（低敏）
      table.string('last_failure_reason', 500).nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：每个组织+类别一条
      table.unique(['organization_id', 'data_class'], 'idx_ocj_org_data_class_unique')
      table.index(['organization_id', 'status'], 'idx_ocj_org_status')
      table.index(['last_run_at'], 'idx_ocj_last_run_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
