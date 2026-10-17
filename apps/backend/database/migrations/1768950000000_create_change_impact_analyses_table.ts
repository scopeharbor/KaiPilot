import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * change_impact_analyses 表：V2 变更影响分析快照（v2-change-management-impact-analysis D1）。
 * 每次分析创建一条快照记录，刷新生成新记录。旧记录保留用于审计和历史比较。
 */
export default class extends BaseSchema {
  protected tableName = 'change_impact_analyses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目/变更请求归属
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
        .bigInteger('change_request_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('change_requests')
        .onDelete('CASCADE')

      // 规则版本与输入签名
      table.string('rule_version', 20).notNullable().defaultTo('2.0.0')
      table.string('input_signature', 64).notNullable()
      table.string('output_hash', 64).nullable()

      // 状态：pending / completed / failed / stale
      table.string('status', 20).notNullable().defaultTo('pending')
      table.check("status IN ('pending','completed','failed','stale')")

      // 过期原因（status=stale 时填写）
      table.text('stale_reason').nullable()

      // 分析范围 JSON（dimensions、maxPropagationDepth、includeEvidenceDetails）
      table.json('scope').nullable()

      // 分组摘要 JSON（totalAffected、severityDistribution、dimensionSummaries）
      table.json('summary').nullable()

      // warnings JSON 数组
      table.json('warnings').nullable()
      // missingInputs JSON 数组
      table.json('missing_inputs').nullable()

      // AI 解释摘要 JSON（provider、model、confidence、assumptions、tokenCost）
      table.json('ai_explanation').nullable()

      // 人工确认
      table
        .bigInteger('confirmed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('confirmed_at').nullable()
      table.text('confirm_reason').nullable()

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['change_request_id'], 'idx_cia_change_request')
      table.index(['organization_id', 'project_id', 'status'], 'idx_cia_org_project_status')
      table.index(['created_at'], 'idx_cia_created_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
