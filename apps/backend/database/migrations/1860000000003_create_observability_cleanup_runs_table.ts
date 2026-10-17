import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * observability_cleanup_runs 表：V3 清理执行记录。
 *
 * 每次执行一条记录，run_key 保证幂等。
 * 低敏设计：只存计数、哈希和状态。
 *
 * v3-observability-data-retention §4.3
 */
export default class extends BaseSchema {
  protected tableName = 'observability_cleanup_runs'

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

      // 关联清理作业
      table.bigInteger('job_id').unsigned().notNullable()

      // 数据类别
      table.string('data_class', 50).notNullable()

      // 幂等键
      table.string('run_key', 200).notNullable()

      // 状态
      table.string('status', 20).notNullable().defaultTo('previewed')
      table.check("status IN ('previewed','completed','failed','partial')")

      // 执行统计
      table.integer('records_eligible').unsigned().notNullable().defaultTo(0)
      table.integer('records_deleted').unsigned().notNullable().defaultTo(0)
      table.integer('records_failed').unsigned().notNullable().defaultTo(0)
      table.integer('aggregates_created').unsigned().notNullable().defaultTo(0)
      table.boolean('aggregate_failed').notNullable().defaultTo(false)

      // 失败原因（低敏）
      table.string('failure_reason', 500).nullable()

      // 时间戳
      table.timestamp('started_at').notNullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable()

      // 索引
      table.unique(['organization_id', 'run_key'], 'idx_ocrun_org_run_key_unique')
      table.index(['organization_id', 'data_class'], 'idx_ocrun_org_data_class')
      table.index(['job_id'], 'idx_ocrun_job_id')
      table.index(['started_at'], 'idx_ocrun_started_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
