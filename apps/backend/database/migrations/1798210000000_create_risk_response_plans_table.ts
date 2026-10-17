import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-risk-management-full — risk_response_plans table.
 * Each risk can have multiple response plans with status tracking.
 * Completing all response plans does NOT auto-close the risk.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('risk_response_plans', (table) => {
      table.bigIncrements('id')

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
        .bigInteger('risk_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('risks')
        .onDelete('CASCADE')

      // 策略类型
      table.string('strategy_type', 20).notNullable()
      table.check(
        "strategy_type IN ('avoid','mitigate','transfer','accept','contingency','escalate')",
      )

      // 动作描述
      table.text('action_description').notNullable()

      // 负责人
      table
        .bigInteger('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 目标日期
      table.date('target_date').nullable()

      // 状态流转
      table.string('status', 20).notNullable().defaultTo('planned')
      table.check("status IN ('planned','in_progress','completed','cancelled','overdue')")

      // 关联任务
      table
        .bigInteger('related_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')

      // 完成证据与时间
      table.text('completion_evidence').nullable()
      table.date('completed_at').nullable()

      // 审计关联
      table.bigInteger('audit_log_id').unsigned().nullable()

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 软删除 + 时间戳
      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 索引
      table.index(['organization_id', 'project_id'], 'idx_rrp_org_project')
      table.index(['risk_id'], 'idx_rrp_risk')
      table.index(['project_id', 'status'], 'idx_rrp_project_status')
      table.index(['project_id', 'strategy_type'], 'idx_rrp_project_strategy')
      table.index(['project_id', 'target_date'], 'idx_rrp_project_target_date')
      table.index(['related_task_id'], 'idx_rrp_related_task')
      table.index(['owner_id'], 'idx_rrp_owner')
    })
  }

  async down() {
    this.schema.dropTable('risk_response_plans')
  }
}
