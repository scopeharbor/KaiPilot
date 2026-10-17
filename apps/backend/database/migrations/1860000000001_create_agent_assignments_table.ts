/**
 * v3-copilot-agent-as-assignee —— 创建 agent_assignments 表。
 *
 * 记录 AI Agent 被分配执行任务的分配记录：
 * - 每条记录关联一个任务、项目、组织
 * - 包含截止时间、状态（pending/completed/overdue/failed）
 * - 完成时可关联 AI 草案（draft_id）
 * - 不携带 prompt/modelOutput/token/secret 等敏感数据
 *
 * 方言兼容：使用 SQLite 和 PostgreSQL 都支持的标准语法。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class CreateAgentAssignmentsTable extends BaseSchema {
  protected tableName = 'agent_assignments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').notNullable()
      table
        .integer('task_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')
      table
        .integer('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.string('assignee_type', 10).notNullable().defaultTo('user')
      table
        .integer('assigned_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.timestamp('due_time', { useTz: true }).notNullable()
      table.string('status', 20).notNullable().defaultTo('pending')
      table.integer('draft_id').unsigned().nullable()
      table.text('notes').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      // 索引：按任务查询、按项目+状态过滤、按组织+截止时间查询逾期
      table.index(['task_id'], 'idx_agent_assignments_task_id')
      table.index(['project_id', 'status'], 'idx_agent_assignments_project_status')
      table.index(['organization_id', 'due_time'], 'idx_agent_assignments_org_due_time')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
