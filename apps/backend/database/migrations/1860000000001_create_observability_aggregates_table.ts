import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * observability_aggregates 表：V3 观察数据聚合固化。
 *
 * D2：过期前先落聚合再删明细。聚合记录按月/按类别固化。
 * aggregate_hash 确定性保证同一快照产出同一聚合。
 * prohibited_fields_json 记录已排除的禁存字段（D7）。
 *
 * v3-observability-data-retention §3.1
 */
export default class extends BaseSchema {
  protected tableName = 'observability_aggregates'

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

      // 数据类别与档期
      table.string('data_class', 50).notNullable()
      table.string('tier', 20).notNullable()

      // 聚合周期
      table.timestamp('period_start').notNullable()
      table.timestamp('period_end').notNullable()

      // 聚合摘要
      table.integer('record_count').unsigned().notNullable().defaultTo(0)

      // 确定性哈希
      table.string('aggregate_hash', 64).notNullable()

      // 已排除的禁存字段列表 JSON
      table.json('prohibited_fields_json').notNullable()

      // 固化时间
      table.timestamp('materialized_at').notNullable()

      // 时间戳
      table.timestamp('created_at').notNullable()

      // 索引
      table.index(['organization_id', 'data_class'], 'idx_oa_org_data_class')
      table.index(['organization_id', 'data_class', 'period_start'], 'idx_oa_org_class_period')
      table.index(['aggregate_hash'], 'idx_oa_aggregate_hash')
      table.index(['materialized_at'], 'idx_oa_materialized_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
