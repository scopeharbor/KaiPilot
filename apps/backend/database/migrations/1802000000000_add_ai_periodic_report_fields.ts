import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'report_versions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 周期报表字段
      table.string('period_type', 20).nullable()
      table.text('prev_date_range', 'jsonb').nullable()
      table.string('ai_draft_ref', 255).nullable()
      table.text('input_source_hashes', 'jsonb').nullable()
      table.text('model_summary', 'jsonb').nullable()
      table.text('cost_summary', 'jsonb').nullable()
      // 审核与重试字段
      table.integer('attempt').defaultTo(1).nullable()
      table.string('idempotency_key', 255).nullable()
      table.text('review_notes', 'longtext').nullable()
      table.string('review_action', 20).nullable()
      // 退回追踪
      table.dateTime('returned_at').nullable()
      table.integer('returned_by').unsigned().nullable()
      // 索引
      table.index(['period_type'], 'idx_report_versions_period_type')
      table.index(['idempotency_key'], 'idx_report_versions_idempotency_key')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('period_type')
      table.dropColumn('prev_date_range')
      table.dropColumn('ai_draft_ref')
      table.dropColumn('input_source_hashes')
      table.dropColumn('model_summary')
      table.dropColumn('cost_summary')
      table.dropColumn('attempt')
      table.dropColumn('idempotency_key')
      table.dropColumn('review_notes')
      table.dropColumn('review_action')
      table.dropColumn('returned_at')
      table.dropColumn('returned_by')
    })
  }
}
