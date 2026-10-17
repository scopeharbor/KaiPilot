import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-risk-management-full — risk_signal_candidates table.
 * Rule-based risk signal candidates with idempotency key and expiry.
 * Zero writes to formal business tables.
 * Only user confirmation can create formal risks via RiskService.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('risk_signal_candidates', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 规则信息
      table.string('rule_id', 80).notNullable()
      table.string('rule_version', 20).notNullable()

      // 严重级别
      table.string('severity', 20).notNullable()
      table.check("severity IN ('low','medium','high','critical')")

      // 证据（JSON：引用列表）
      table.json('evidence').notNullable()

      // 建议动作
      table.text('recommended_action').notNullable()

      // 置信度（0-1）
      table.decimal('confidence', 3, 2).notNullable().defaultTo(1.0)

      // 来源
      table.string('source', 30).notNullable().defaultTo('rule_engine')
      table.check("source IN ('rule_engine','ai_suggestion','ai_draft','manual')")

      // 知识库模板引用
      table.bigInteger('template_id').unsigned().nullable()

      // 幂等键（同一项目事实+规则版本=相同idempotencyKey）
      table.string('idempotency_key', 128).notNullable()

      // 过期时间
      table.timestamp('expires_at', { useTz: false }).notNullable()

      // 状态
      table.string('status', 20).notNullable().defaultTo('pending')
      table.check("status IN ('pending','accepted','rejected','expired')")

      // 采纳/拒绝详情
      table
        .bigInteger('resolved_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('resolved_at', { useTz: false }).nullable()

      // 采纳后创建的风险 ID
      table.bigInteger('accepted_risk_id').unsigned().nullable()

      table.bigInteger('audit_log_id').unsigned().nullable()

      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 索引
      table.index(['organization_id', 'project_id'], 'idx_rsc_org_project')
      table.index(['project_id', 'status'], 'idx_rsc_project_status')
      table.index(['project_id', 'rule_id'], 'idx_rsc_project_rule')
      table.index(['project_id', 'expires_at'], 'idx_rsc_project_expires')
      table.index(['project_id', 'severity'], 'idx_rsc_project_severity')
      table.unique(['project_id', 'idempotency_key'], 'uq_rsc_idempotency')
      table.check('confidence >= 0 AND confidence <= 1')
      table.check('expires_at > created_at')
    })
  }

  async down() {
    this.schema.dropTable('risk_signal_candidates')
  }
}
