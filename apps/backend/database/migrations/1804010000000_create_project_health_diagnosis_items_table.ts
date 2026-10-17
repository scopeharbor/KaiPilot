import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * project_health_diagnosis_items 表：健康诊断维度信号明细（v2-ai-project-health-diagnosis D1）。
 * 每条记录对应一个维度的信号条目，包含规则 ID、严重度、评分影响、证据摘要、来源引用和建议动作。
 */
export default class extends BaseSchema {
  protected tableName = 'project_health_diagnosis_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 归属诊断
      table
        .bigInteger('diagnosis_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('project_health_diagnoses')
        .onDelete('CASCADE')

      // 诊断维度
      table.string('dimension', 30).notNullable()
      table.check(
        "dimension IN ('progress','critical_path','milestone','resource','risk','change_impact','collaboration','data_integrity')",
      )

      // 规则 ID（R001~R010）
      table.string('rule_id', 10).notNullable()

      // 严重度
      table.string('severity', 20).notNullable()
      table.check("severity IN ('critical','high','medium','low','ok')")

      // 评分影响（正负值，影响总体分）
      table.integer('score_impact').notNullable().defaultTo(0)

      // 证据摘要（低敏，不含完整上下文）
      table.text('evidence').nullable()

      // 来源实体引用
      table.string('source_type', 50).nullable()
      table.bigInteger('source_id').unsigned().nullable()

      // 建议动作
      table.text('suggested_action').nullable()

      // 是否需要人工复核
      table.boolean('requires_review').notNullable().defaultTo(false)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['diagnosis_id'])
      table.index(['diagnosis_id', 'dimension'])
      table.index(['diagnosis_id', 'severity'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
