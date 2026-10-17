import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— issues 议题与缺陷追踪表（W1.2）。
 *
 * - related_task_id → tasks ON DELETE SET NULL（关联任务删除后保留议题）
 * - reported_by → users ON DELETE RESTRICT；assignee_id → users ON DELETE SET NULL
 * - UNIQUE(project_id, code) 项目内业务编号唯一（如 ISS-001，服务层生成）
 * - type / severity / priority / status 带 CHECK 约束（帕累托 issue_type /
 *   issue_severity 维度直接按此聚合）
 * - 状态机：open → in_progress → resolved / closed / rejected；resolved 回填
 *   root_cause / resolution / resolved_at，closed 打 closed_at
 *
 * 方言兼容：无 `.after()`；索引显式命名（≤ PostgreSQL 63 字节）。
 */
export default class extends BaseSchema {
  protected tableName = 'issues'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
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
        .bigInteger('related_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')

      table
        .bigInteger('reported_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      table
        .bigInteger('assignee_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.string('code', 64).notNullable()
      table.string('title', 255).notNullable()
      table.text('description').nullable()

      // 分类：bug/blocker/technical/process/other
      table.string('type', 20).notNullable().defaultTo('bug')
      table.check("type IN ('bug','blocker','technical','process','other')")

      // 四级严重度：critical/major/minor/trivial
      table.string('severity', 20).notNullable().defaultTo('minor')
      table.check("severity IN ('critical','major','minor','trivial')")

      // 优先级：urgent/high/medium/low
      table.string('priority', 20).notNullable().defaultTo('medium')
      table.check("priority IN ('urgent','high','medium','low')")

      // 状态机与闭环字段
      table.string('status', 20).notNullable().defaultTo('open')
      table.check("status IN ('open','in_progress','resolved','closed','rejected')")
      table.text('root_cause').nullable()
      table.text('resolution').nullable()
      table.timestamp('resolved_at').nullable()
      table.timestamp('closed_at').nullable()

      // 软删除 + 时间戳
      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 约束与索引
      table.unique(['project_id', 'code'])
      table.index(['organization_id', 'project_id', 'status'], 'idx_issues_org_project_status')
      table.index(['project_id', 'type'], 'idx_issues_project_type')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
