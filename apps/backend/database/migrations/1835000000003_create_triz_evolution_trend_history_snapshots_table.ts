import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_evolution_trend_history_snapshots 表：TRIZ 进化趋势历史对比快照
 * （v3-triz-evolution-trend-analysis §3.1）。
 *
 * 每条记录是一次「当前 run vs 授权 baseline run」的有界低敏对比结果
 * （趋势 delta、风险 delta 摘要、来源 hash 比对）。对比为 advisory，
 * 历史样本不足时预测抑制，不编造未来趋势点。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_evolution_trend_history_snapshots'

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

      // 对比基准（同组织同项目同 scope 的既有 run）
      table.bigInteger('baseline_run_id').unsigned().nullable()
      table.string('comparison_mode', 30).notNullable().defaultTo('latest_prior')
      table.check("comparison_mode IN ('latest_prior','explicit_baseline')")

      // 低敏对比结果
      table.json('trend_delta_json').notNullable().defaultTo('[]')
      table.json('risk_delta_json').notNullable().defaultTo('{}')
      table.json('source_hashes_json').notNullable().defaultTo('{}')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（teth = triz evolution trend history）
      table.index(['run_id'], 'idx_teth_run')
      table.index(
        ['organization_id', 'project_id', 'baseline_run_id'],
        'idx_teth_org_project_baseline',
      )
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
