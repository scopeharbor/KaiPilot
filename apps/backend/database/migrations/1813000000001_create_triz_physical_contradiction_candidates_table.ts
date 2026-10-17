import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_physical_contradiction_candidates 表：V3 TRIZ 物理矛盾分析候选快照（v3-triz-physical-contradiction-analyzer §3.2）。
 *
 * 每条记录是物理矛盾分析运行产出的一个候选矛盾快照。
 * 组织+项目双隔离；candidate_key + source_hashes 保证可追溯和陈旧检测。
 * 只存低敏摘要、hash、refs，不存完整证据正文或敏感路径。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_physical_contradiction_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 运行引用
      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_physical_contradiction_analysis_runs')
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

      // 稳定标识与规则
      table.string('candidate_key', 80).notNullable()
      table.string('rule_id', 20).notNullable()
      table.string('rule_version', 20).notNullable().defaultTo('1.0.0')

      // 候选状态
      table.string('status', 20).notNullable().defaultTo('unreviewed')
      table.check("status IN ('unreviewed','reviewed','previewed','blocked_stale','dismissed')")

      // 对立参数（同一参数）
      table.string('parameter_key', 60).notNullable()
      table.json('requirement_a_json').notNullable()
      table.json('requirement_b_json').notNullable()

      // 分离维度
      table.string('separation_axis', 20).notNullable()
      table.check(
        "separation_axis IN ('time','space','condition','stakeholder','level','phase','resource_state','none')",
      )

      // 条件上下文
      table.text('context_a').notNullable().defaultTo('')
      table.text('context_b').notNullable().defaultTo('')
      table.json('condition_refs_json').notNullable().defaultTo('[]')

      // 评分
      table.string('severity', 20).notNullable().defaultTo('medium')
      table.check("severity IN ('critical','high','medium','low')")
      table.decimal('confidence', 4, 3).notNullable().defaultTo(0)
      table.decimal('impact_score', 4, 3).notNullable().defaultTo(0)

      // 低敏证据 refs JSON
      table.json('evidence_refs_json').notNullable().defaultTo('[]')

      // 影响范围
      table.json('affected_scope_json').notNullable().defaultTo('[]')

      // 分离原则建议 refs JSON
      table.json('principle_refs_json').notNullable().defaultTo('[]')

      // 确定性理由摘要
      table.text('rationale_summary').notNullable().defaultTo('')

      // 警告代码
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      // 来源 hash（用于陈旧检测）
      table.json('source_hashes_json').notNullable().defaultTo('{}')

      // 确定性输出 hash
      table.string('output_hash', 80).notNullable()

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

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'candidate_key'], 'idx_tpcc_org_project_key')
      table.index(['run_id', 'candidate_key'], 'idx_tpcc_run_key')
      table.index(['organization_id', 'project_id', 'status'], 'idx_tpcc_org_project_status')
      table.index(['organization_id', 'project_id', 'separation_axis'], 'idx_tpcc_org_project_axis')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
