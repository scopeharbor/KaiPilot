import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-skill-eval-system —— skill_eval_reports 迁移（D9）。
 *
 * 组织级 Skill 质量评估报告持久化。JSON 列以 text 存储，应用层解析。
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'skill_eval_reports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离（强制过滤，红线）
      table.integer('organization_id').unsigned().notNullable()

      // Skill 关联
      table.integer('skill_id').unsigned().notNullable()

      // 评估结果
      table.integer('score').notNullable().defaultTo(0)
      table.text('dimension_scores').notNullable().defaultTo('[]') // JSON: DimensionScore[]
      table.text('issues').notNullable().defaultTo('[]') // JSON: string[]
      table.text('ai_advisory').nullable() // JSON: AiAssistAdvisory | null

      // 转移建议
      table.string('suggested_transition', 64).nullable()

      // 评估参考时间
      table.string('reference_time', 64).notNullable()

      // 审计
      table.integer('created_by').unsigned().notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'skill_id'], 'idx_ser_org_skill')
      table.index(['organization_id', 'created_at'], 'idx_ser_org_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
