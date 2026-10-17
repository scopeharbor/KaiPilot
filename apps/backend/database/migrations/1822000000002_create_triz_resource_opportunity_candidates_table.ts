import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_resource_opportunity_candidates 表：V3 TRIZ 资源机会候选（v3-triz-resource-analyzer §3.1）。
 *
 * 每条记录是一个未利用资源机会候选——基于确定性规则从资源快照中识别的机会。
 * 包含机会类型、严重度、置信度、影响分数、审查状态与建议操作。
 * 组织+项目双隔离；关联 run_id 确保一致性。
 * 不自动写入正式资源或任务事实。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_resource_opportunity_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 关联分析运行
      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_resource_analysis_runs')
        .onDelete('CASCADE')

      // 组织/项目归属（双隔离）
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

      // 候选标识与类型
      table.string('opportunity_key', 80).notNullable()
      table.string('opportunity_type', 40).notNullable()
      table.string('rule_id', 20).notNullable()

      // 审查状态
      table.string('status', 30).notNullable().defaultTo('unreviewed')
      table.check("status IN ('unreviewed','reviewed','previewed','blocked_stale','dismissed')")

      // 评分
      table.string('severity', 20).notNullable()
      table.check("severity IN ('critical','high','medium','low')")
      table.float('confidence').notNullable()
      table.float('impact_score').notNullable()

      // 中文标题与理由
      table.string('title', 500).notNullable()
      table.text('rationale_summary').notNullable()

      // JSON 字段
      table.json('resource_refs_json').notNullable().defaultTo('[]')
      table.json('target_refs_json').notNullable().defaultTo('[]')
      table.json('suggested_actions_json').notNullable().defaultTo('[]')
      table.json('source_hashes_json').notNullable().defaultTo('{}')
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      // AI 解释 ref（可为 null）
      table.json('ai_explanation_ref_json').nullable()

      // 审查元数据
      table.bigInteger('reviewed_by').unsigned().nullable()
      table.timestamp('reviewed_at').nullable()

      // 确定性输出 hash
      table.string('output_hash', 80).notNullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（troc = triz resource opportunity candidates）
      table.index(['organization_id', 'project_id', 'opportunity_key'], 'idx_troc_org_project_key')
      table.index(['run_id', 'opportunity_key'], 'idx_troc_run_key')
      table.index(['organization_id', 'project_id', 'status'], 'idx_troc_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'opportunity_type'],
        'idx_troc_org_project_type',
      )
      table.index(['organization_id', 'project_id', 'severity'], 'idx_troc_org_project_severity')
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_troc_org_project_created')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
