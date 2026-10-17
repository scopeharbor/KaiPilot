import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * change_requests V2 扩展：影响分析引用字段（v2-change-management-impact-analysis D1）。
 *
 * 增加 current_impact_analysis_id（当前分析引用）、approve_ref_analysis_id（审批引用分析）、
 * impact_analysis_confirm_status（确认状态）、impact_analysis_summary_override（摘要冗余）。
 * 不移除已有字段，向后兼容。旧数据默认为 null。
 */
export default class extends BaseSchema {
  protected tableName = 'change_requests'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 当前影响分析引用
      table
        .bigInteger('current_impact_analysis_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('change_impact_analyses')
        .onDelete('SET NULL')

      // 审批引用的影响分析 ID
      table
        .bigInteger('approve_ref_analysis_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('change_impact_analyses')
        .onDelete('SET NULL')

      // 影响分析确认状态：not_checked / confirmed / confirmed_stale
      table.string('impact_analysis_confirm_status', 30).nullable().defaultTo(null)
      // 审批引用时保存的影响摘要冗余（审批时刻的快照摘要）
      table.json('approve_ref_summary_override').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('current_impact_analysis_id')
      table.dropColumn('approve_ref_analysis_id')
      table.dropColumn('impact_analysis_confirm_status')
      table.dropColumn('approve_ref_summary_override')
    })
  }
}
