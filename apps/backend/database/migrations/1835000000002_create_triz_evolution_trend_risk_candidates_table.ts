import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_evolution_trend_risk_candidates 表：TRIZ 进化趋势风险预警候选
 * （v3-triz-evolution-trend-analysis §3.1）。
 *
 * 每条记录是一个趋势风险预警候选——确定性规则识别、稳定评分、审查导向。
 * 候选为 advisory 预警产物，不是正式风险登记项；任何正式写入须经既有人审链路。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_evolution_trend_risk_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_evolution_trend_analysis_runs')
        .onDelete('CASCADE')
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

      // 候选标识
      table.string('risk_key', 80).notNullable()
      table.string('trend_id', 60).notNullable()
      table.string('risk_type', 60).notNullable()
      table.check(
        "risk_type IN ('role_gap','information_flow_delay','process_rigidity','subsystem_imbalance','external_dependency_bottleneck','complexity_granularity_risk','ideality_decline','coordination_drift')",
      )
      table.string('rule_id', 20).notNullable()

      // 审查状态
      table.string('status', 30).notNullable().defaultTo('unreviewed')
      table.check("status IN ('unreviewed','reviewed','previewed','blocked_stale','dismissed')")

      // 评分
      table.string('severity', 20).notNullable().defaultTo('low')
      table.check("severity IN ('critical','high','medium','low')")
      table.float('confidence').notNullable().defaultTo(0)
      table.float('impact_score').notNullable().defaultTo(0)

      // 低敏标题与理由摘要
      table.string('title', 255).notNullable().defaultTo('')
      table.text('rationale_summary').notNullable().defaultTo('')

      // 关联 refs / 建议 / hashes / 警告
      table.json('trend_refs_json').notNullable().defaultTo('[]')
      table.json('target_refs_json').notNullable().defaultTo('[]')
      table.json('suggested_actions_json').notNullable().defaultTo('[]')
      table.json('source_hashes_json').notNullable().defaultTo('{}')
      table.json('warning_codes_json').notNullable().defaultTo('[]')
      table.json('ai_explanation_ref_json').nullable()

      // 确定性输出 hash
      table.string('output_hash', 80).notNullable().defaultTo('')

      // 审查元数据
      table.bigInteger('reviewed_by').unsigned().nullable()
      table.timestamp('reviewed_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（tetr = triz evolution trend risks）
      table.index(['run_id'], 'idx_tetr_run')
      table.index(['organization_id', 'project_id', 'status'], 'idx_tetr_org_project_status')
      table.index(['organization_id', 'project_id', 'risk_key'], 'idx_tetr_org_project_key')
      table.index(['organization_id', 'project_id', 'risk_type'], 'idx_tetr_org_project_type')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
