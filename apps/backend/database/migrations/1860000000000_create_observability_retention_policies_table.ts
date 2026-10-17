import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * observability_retention_policies 表：V3 观察数据保留策略。
 *
 * 每个组织一条记录（organization_id UNIQUE）。
 * 默认系统策略不持久化，此表只存覆盖。
 * policy_hash 允许确定性检测策略变更。
 *
 * v3-observability-data-retention §3.1
 */
export default class extends BaseSchema {
  protected tableName = 'observability_retention_policies'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 作用域：组织级（每个组织一条）
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 分类配置 JSON（ObservabilityRetentionCategoryPolicy[]）
      table.json('categories_json').notNullable()

      // 策略哈希（确定性，用于比对与审计）
      table.string('policy_hash', 64).notNullable()

      // 操作人
      table.bigInteger('updated_by').unsigned().nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：每个组织一条策略
      table.unique(['organization_id'], 'idx_ortp_org_unique')
      table.index(['policy_hash'], 'idx_ortp_policy_hash')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
