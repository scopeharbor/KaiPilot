import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_evolution_trend_scores 表：TRIZ 进化趋势评分快照
 * （v3-triz-evolution-trend-analysis §3.1）。
 *
 * 每条记录是某次运行下一个趋势维度的评分快照（阶段/评分/置信度/严重度/方向）。
 * 快照为 advisory 诊断产物，不是正式路线图或预测事实。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_evolution_trend_scores'

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

      // 趋势标识
      table.string('trend_key', 80).notNullable()
      table.string('trend_id', 60).notNullable()
      table.check(
        "trend_id IN ('completeness','energy_information_transmission','dynamization','uneven_subsystem_evolution','transition_to_supersystem','micro_level_transition','ideality_increase','coordination')",
      )

      // 评分
      table.string('stage', 20).notNullable().defaultTo('nascent')
      table.check("stage IN ('nascent','developing','established','advanced')")
      table.float('score').notNullable().defaultTo(0)
      table.float('confidence').notNullable().defaultTo(0)
      table.string('severity', 20).notNullable().defaultTo('low')
      table.check("severity IN ('critical','high','medium','low')")
      table.string('direction', 20).notNullable().defaultTo('unknown')
      table.check("direction IN ('improving','stable','declining','unknown')")

      // 低敏来源 refs / hashes / 度量 / 警告
      table.json('source_refs_json').notNullable().defaultTo('[]')
      table.json('source_hashes_json').notNullable().defaultTo('{}')
      table.json('metrics_json').notNullable().defaultTo('{}')
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（tets = triz evolution trend scores）
      table.index(['run_id'], 'idx_tets_run')
      table.index(['organization_id', 'project_id', 'trend_id'], 'idx_tets_org_project_trend')
      table.index(['organization_id', 'project_id', 'trend_key'], 'idx_tets_org_project_key')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
