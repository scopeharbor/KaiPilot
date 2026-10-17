import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ai_slo_thresholds 表：组织级 AI SLO 告警阈值持久化（最小表）。
 *
 * v3-ai-quality-cost-console-deferred-p1 §1 / D1：
 * - 每组织每指标一行，warning/critical 双档同行（与 AiSloDefinition 形状对齐）；
 * - runbook_ref 非空（D2 硬约束：无 runbook 的指标不得成为告警项）；
 * - 可空表启动：无持久化行时由声明式默认阈值兜底（slo_threshold_service）；
 * - 只存阈值定义，不存 prompt/模型输出/token/secret。
 */
export default class extends BaseSchema {
  protected tableName = 'ai_slo_thresholds'

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

      // 指标（ttft / failure_rate / degradation_rate / budget_burn / latency_violation）
      table.string('indicator', 32).notNullable()

      // warning 档阈值
      table.string('warning_operator', 8).notNullable()
      table.double('warning_value').notNullable()
      table.string('warning_unit', 32).notNullable()

      // critical 档阈值
      table.string('critical_operator', 8).notNullable()
      table.double('critical_value').notNullable()
      table.string('critical_unit', 32).notNullable()

      // 评估窗口（毫秒）与 runbook 引用（非空硬约束）
      table.bigInteger('window_ms').unsigned().notNullable()
      table.string('runbook_ref', 256).notNullable()

      // 阈值来源说明/基线引用
      table.string('threshold_source', 256).notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // 每组织每指标唯一定义
      table.unique(['organization_id', 'indicator'], {
        indexName: 'uq_ai_slo_thresholds_org_indicator',
      })
      table.index(['organization_id'], 'idx_ai_slo_thresholds_org')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
