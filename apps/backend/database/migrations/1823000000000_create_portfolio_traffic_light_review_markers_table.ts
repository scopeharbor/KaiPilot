import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-portfolio-traffic-light —— PMO 组合交通灯复核标记迁移。
 *
 * 存储 PMO 对特定项目交通灯的复核标记，不修改项目事实。
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'portfolio_traffic_light_review_markers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离（红线）
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()

      // 复核信息
      table.integer('actor_id').unsigned().notNullable()
      table.string('review_state', 32).notNullable() // acknowledged | needs_follow_up | false_positive
      table.text('note').nullable()

      // 规则版本与输入签名（用于 stale 检测）
      table.string('rule_version', 64).notNullable()
      table.string('input_signature_hash', 64).notNullable()

      // 前一次复核状态（审计）
      table.string('previous_review_state', 32).nullable()

      // Stale 检测
      table.integer('stale').notNullable().defaultTo(0) // SQLite boolean as 0/1

      // 时间戳
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'project_id'], 'idx_ptlrm_org_project')
      table.index(['organization_id', 'created_at'], 'idx_ptlrm_org_created')
      table.unique(['organization_id', 'project_id'], 'uq_ptlrm_org_project')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
