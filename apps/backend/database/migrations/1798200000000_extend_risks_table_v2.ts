import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-risk-management-full — extends risks table with V2 fields:
 * riskLevel (server-computed), priority, triggerCondition, review dates,
 * closed reason/notes, and extended source enum.
 *
 * Note: SQLite does not support ADD CONSTRAINT in ALTER TABLE (ALTER TABLE ADD CHECK is
 * not supported), so we move CHECK constraint enforcement to the application Validator layer.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('risks', (table) => {
      // 风险等级（由服务端按矩阵配置和评分计算，禁止前端覆盖）
      table.string('risk_level', 10).notNullable().defaultTo('medium')

      // 优先级字段
      table.string('priority', 10).notNullable().defaultTo('normal')

      // 触发条件详细描述
      table.text('trigger_condition').nullable()

      // 复查相关
      table.date('next_review_at').nullable()
      table.date('last_review_at').nullable()

      // 关闭原因与说明
      table.string('closed_reason', 20).nullable()
      table.text('closed_notes').nullable()
    })

    // V2 索引（SQLite supports CREATE INDEX in ALTER TABLE via raw）
    this.schema.raw(
      'CREATE INDEX IF NOT EXISTS idx_risks_project_risk_level ON risks (project_id, risk_level)',
    )
    this.schema.raw(
      'CREATE INDEX IF NOT EXISTS idx_risks_project_priority ON risks (project_id, priority)',
    )
    this.schema.raw(
      'CREATE INDEX IF NOT EXISTS idx_risks_project_next_review ON risks (project_id, next_review_at)',
    )
    this.schema.raw(
      'CREATE INDEX IF NOT EXISTS idx_risks_project_last_review ON risks (project_id, last_review_at)',
    )
    this.schema.raw(
      'CREATE INDEX IF NOT EXISTS idx_risks_project_closed_reason ON risks (project_id, closed_reason)',
    )
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS idx_risks_project_risk_level')
    this.schema.raw('DROP INDEX IF EXISTS idx_risks_project_priority')
    this.schema.raw('DROP INDEX IF EXISTS idx_risks_project_next_review')
    this.schema.raw('DROP INDEX IF EXISTS idx_risks_project_last_review')
    this.schema.raw('DROP INDEX IF EXISTS idx_risks_project_closed_reason')

    this.schema.alterTable('risks', (table) => {
      table.dropColumn('closed_notes')
      table.dropColumn('closed_reason')
      table.dropColumn('last_review_at')
      table.dropColumn('next_review_at')
      table.dropColumn('trigger_condition')
      table.dropColumn('priority')
      table.dropColumn('risk_level')
    })
  }
}
