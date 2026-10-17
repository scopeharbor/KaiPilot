import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * multi_project_dependency_detection_runs 表：检测批次记录
 * v3-multi-project-dependency-detection / §3.1
 *
 * - organization_id 强制组织隔离
 * - 每个 run 关联一个 plan token 和 scope hash
 * - 记录检测状态、规则集、结果计数和时效
 */
export default class extends BaseSchema {
  protected tableName = 'multi_project_dependency_detection_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 触发者
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 检测计划与范围
      table.string('plan_token', 64).notNullable()
      table.string('scope_hash', 64).notNullable()
      table.string('rule_set_key', 50).notNullable().defaultTo('default')

      // 源新鲜度
      table.string('source_freshness_hash', 64).notNullable()

      // 运行状态
      table.string('status', 20).notNullable().defaultTo('planned')
      table.check("status IN ('planned','running','completed','failed','cancelled','stale')")

      // 结果统计
      table.integer('result_count').notNullable().defaultTo(0)
      table.json('result_summary').nullable() // Record<DetectionSeverity, number>

      // 警告码
      table.json('warnings').nullable() // DetectionWarningCode[]

      // 时间戳与时效
      table.timestamp('started_at').nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('expires_at').nullable()

      // 审计
      table.timestamp('created_at').notNullable().defaultTo(this.raw('CURRENT_TIMESTAMP'))
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'created_at'])
      table.index(['plan_token'])
      table.index(['scope_hash'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
