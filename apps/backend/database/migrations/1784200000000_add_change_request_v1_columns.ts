import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 补齐 change_requests 表的 V1 简单审批所需字段（simple-change-approval）。
 *
 * - organization_id：组织级数据隔离（红线 5）
 * - requester_id / approver_id：请求人 / 审批人
 * - priority：低/中/高/紧急
 * - conditions：有条件批准时的条件文本
 * - decision_reason：审批原因
 * - impact_summary：六维结构化影响摘要 JSON
 * - 实施时间戳 implemented_at 已有，补充 implemented_by / closed_at / closed_by
 * - 新增索引：organization_id + project_id + status + updated_at、requester_id、approver_id
 *
 * 不移除已有字段（cr_code、ai_metadata 等），保持向后兼容。
 */
export default class extends BaseSchema {
  protected tableName = 'change_requests'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 组织隔离
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 请求人 / 审批人
      table
        .bigInteger('requester_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .bigInteger('approver_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 优先级（枚举校验在 Validator/Service 层）
      table.string('priority', 20).notNullable().defaultTo('medium')

      // 六维结构化影响摘要
      table.json('impact_summary').nullable()

      // 有条件批准时的条件
      table.text('conditions').nullable()

      // 决策原因
      table.text('decision_reason').nullable()

      // 实施人 / 关闭时间
      table
        .bigInteger('implemented_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('closed_at').nullable()
      table
        .bigInteger('closed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 复合索引：列表查询（organization + project + status + updated_at）
      table.index(['organization_id', 'project_id', 'status', 'updated_at'])
      // 请求人索引
      table.index(['requester_id'])
      // 审批人索引
      table.index(['approver_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['organization_id', 'project_id', 'status', 'updated_at'])
      table.dropIndex(['requester_id'])
      table.dropIndex(['approver_id'])
      table.dropColumn('organization_id')
      table.dropColumn('requester_id')
      table.dropColumn('approver_id')
      table.dropColumn('priority')
      table.dropColumn('impact_summary')
      table.dropColumn('conditions')
      table.dropColumn('decision_reason')
      table.dropColumn('implemented_by')
      table.dropColumn('closed_at')
      table.dropColumn('closed_by')
    })
  }
}
