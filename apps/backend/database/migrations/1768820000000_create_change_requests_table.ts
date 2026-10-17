import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * change_requests 表：项目变更管理流程 CR（sec7.2.3）。
 * - cr_code 全局唯一（格式 CR-YYYY-NNNN）
 * - project_id → projects ON DELETE CASCADE
 * - change_type 七类；status 状态机 draft→submitted→under_review→approved/rejected→implemented→closed（+cancelled）
 * 软删除（sec7.5 / design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'change_requests'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 变更编号 CR-YYYY-NNNN，全局唯一
      table.string('cr_code', 32).notNullable().unique()

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table.string('title', 255).notNullable()
      table.text('description').nullable()

      // 变更类型：scope/schedule/cost/resource/quality/risk/other
      table.string('change_type', 20).notNullable().defaultTo('other')
      table.check("change_type IN ('scope','schedule','cost','resource','quality','risk','other')")

      // 状态机
      table.string('status', 20).notNullable().defaultTo('draft')
      table.check(
        "status IN ('draft','submitted','under_review','approved','rejected','implemented','closed','cancelled')",
      )

      table
        .bigInteger('requested_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .bigInteger('reviewed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 结构化影响分析（范围明细、进度影响天数、成本影响金额）
      table.json('impact_analysis').nullable()
      // 关联实体 ID 数组
      table.json('related_task_ids').nullable()
      table.json('related_document_ids').nullable()
      // AI 辅助变更影响分析输出
      table.json('ai_metadata').nullable()
      table.text('approval_comments').nullable()

      // 各阶段时间戳
      table.timestamp('submitted_at').nullable()
      table.timestamp('reviewed_at').nullable()
      table.timestamp('approved_at').nullable()
      table.timestamp('implemented_at').nullable()

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：变更列表、状态筛选（sec7.5；cr_code 已由 unique 覆盖）
      table.index(['project_id'])
      table.index(['status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
