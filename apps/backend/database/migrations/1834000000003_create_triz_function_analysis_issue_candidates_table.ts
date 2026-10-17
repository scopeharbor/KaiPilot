import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_function_analysis_issue_candidates 表：V3 TRIZ 功能分析问题候选（v3-triz-function-analysis-diagram §3.1）。
 *
 * 每条记录是功能分析运行产出的一个功能问题候选快照。
 * 组织+项目双隔离；issue_key 保证稳定引用。
 * 7 种问题类型：trim_candidate / harmful_function / insufficient_function /
 *   excessive_function / duplicate_function / isolated_component / single_point_dependency。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_function_analysis_issue_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 运行引用
      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_function_analysis_runs')
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

      // 稳定问题 key
      table.string('issue_key', 80).notNullable()

      // 问题类型
      table.string('issue_type', 30).notNullable()
      table.check(
        "issue_type IN ('trim_candidate','harmful_function','insufficient_function','excessive_function','duplicate_function','isolated_component','single_point_dependency')",
      )

      // 严重度
      table.string('severity', 20).notNullable().defaultTo('medium')
      table.check("severity IN ('critical','high','medium','low')")

      // 置信度与影响得分
      table.decimal('confidence', 4, 3).notNullable().defaultTo(0)
      table.decimal('impact_score', 4, 3).notNullable().defaultTo(0)

      // 候选状态
      table.string('candidate_status', 20).notNullable().defaultTo('unreviewed')
      table.check(
        "candidate_status IN ('unreviewed','reviewed','dismissed','needs_more_info','blocked_stale')",
      )

      // 关联节点/边 refs JSON
      table.json('node_refs_json').notNullable().defaultTo('[]')
      table.json('edge_refs_json').notNullable().defaultTo('[]')

      // 确定性理由摘要
      table.text('rationale_summary').notNullable().defaultTo('')

      // 建议动作 JSON
      table.json('suggested_actions_json').notNullable().defaultTo('[]')

      // 来源 hashes JSON
      table.json('source_hashes_json').notNullable().defaultTo('{}')

      // AI 解释 ref
      table.string('ai_explanation_ref', 80).nullable()

      // 审查元数据
      table
        .bigInteger('reviewed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('reviewed_at').nullable()

      // 警告代码 JSON
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      // 确定性输出 hash
      table.string('output_hash', 80).notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'issue_key'], 'idx_tfaic_org_project_key')
      table.index(['run_id', 'issue_key'], 'idx_tfaic_run_key')
      table.index(['organization_id', 'project_id', 'issue_type'], 'idx_tfaic_org_project_itype')
      table.index(
        ['organization_id', 'project_id', 'candidate_status'],
        'idx_tfaic_org_project_status',
      )
      table.index(['organization_id', 'project_id', 'severity'], 'idx_tfaic_org_project_severity')
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_tfaic_org_project_created')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
