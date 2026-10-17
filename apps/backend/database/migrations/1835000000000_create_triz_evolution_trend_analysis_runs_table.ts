import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_evolution_trend_analysis_runs 表：V3 TRIZ 进化趋势分析运行
 * （v3-triz-evolution-trend-analysis §3.1）。
 *
 * 每条记录是一次 TRIZ 技术系统进化 8 大趋势分析运行——授权收集项目状态/成员角色/
 * 任务 WBS/依赖/资源/风险/变更/Compiler/TRIZ artifact 等低敏摘要，执行确定性趋势
 * 评分规则，产出趋势评分快照与风险预警候选。
 * 组织+项目双隔离；input_signature + idempotency_key 保证幂等。
 * 不写入正式路线图/任务/风险/资源/排期事实；分析运行与正式项目数据分离。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_evolution_trend_analysis_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目/操作人归属（三隔离）
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
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 运行状态
      table.string('status', 30).notNullable().defaultTo('queued')
      table.check(
        "status IN ('queued','completed','completed_with_warnings','failed','stale','archived')",
      )

      // 分析范围
      table.string('scope_type', 30).notNullable().defaultTo('project')
      table.check("scope_type IN ('project','subsystem','technology_stack','custom')")

      // 幂等与签名
      table.string('input_signature', 80).notNullable()
      table.string('output_hash', 80).nullable()
      table.string('rule_version', 20).notNullable().defaultTo('1.0.0')
      table.string('taxonomy_version', 20).notNullable().defaultTo('1.0.0')
      table.string('idempotency_key', 80).notNullable()

      // 来源摘要 JSON（低敏：仅计数 + hash）
      table.json('source_summary_json').notNullable().defaultTo('{}')
      // 警告摘要 JSON
      table.json('warning_summary_json').notNullable().defaultTo('[]')
      // 趋势/风险计数
      table.integer('trend_count').notNullable().defaultTo(0)
      table.integer('risk_count').notNullable().defaultTo(0)
      // 成本摘要 JSON（仅 AI 调用时有值）
      table.json('cost_summary_json').nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('archived_at').nullable()

      // 索引（teta = triz evolution trend analysis runs）
      table.index(['organization_id', 'project_id', 'status'], 'idx_teta_org_project_status')
      table.index(['organization_id', 'project_id', 'idempotency_key'], 'idx_teta_org_project_idem')
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_teta_org_project_created')
      table.index(['organization_id', 'project_id', 'scope_type'], 'idx_teta_org_project_scope')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
