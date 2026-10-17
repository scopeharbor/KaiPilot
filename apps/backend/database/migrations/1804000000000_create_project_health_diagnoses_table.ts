import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * project_health_diagnoses 表：V2 项目健康诊断快照（v2-ai-project-health-diagnosis D1）。
 * 每次诊断创建一条快照记录，刷新生成新记录。旧记录保留用于审计和历史比较。
 * Dashboard 和报表只能消费 status=confirmed 的诊断。
 */
export default class extends BaseSchema {
  protected tableName = 'project_health_diagnoses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目归属
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

      // 状态：pending / confirmed / rejected / ai_ready / ai_failed
      table.string('status', 20).notNullable().defaultTo('pending')
      table.check("status IN ('pending','confirmed','rejected','ai_ready','ai_failed')")

      // 规则版本与输入/输出签名
      table.string('rule_version', 20).notNullable().defaultTo('1.0.0')
      table.string('input_signature', 64).notNullable()
      table.string('output_hash', 64).nullable()
      table.string('evidence_hash', 64).nullable()

      // 总体评分摘要 JSON（overallScore, overallLabel, dimensionScores, warnings, suggestedActions, evidenceHash）
      table.json('summary').nullable()

      // AI 诊断草稿 JSON（narrativeDraft, recommendedActionsText, assumptions, confidence, questions）
      table.json('ai_draft').nullable()

      // warnings JSON
      table.json('warnings').nullable()

      // 生成信息
      table.bigInteger('generated_by').unsigned().notNullable()
      table.timestamp('generated_at', { useTz: true }).notNullable()

      // 确认信息
      table.bigInteger('confirmed_by').unsigned().nullable()
      table.timestamp('confirmed_at', { useTz: true }).nullable()
      table.text('confirmed_notes').nullable()

      // 驳回信息
      table.bigInteger('rejected_by').unsigned().nullable()
      table.timestamp('rejected_at', { useTz: true }).nullable()
      table.text('reject_reason').nullable()

      // 过期标记
      table.boolean('stale').notNullable().defaultTo(false)
      table.text('stale_reason').nullable()

      // 时间戳
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'project_id'])
      table.index(['project_id', 'status'])
      table.index(['project_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
