import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— requirements 需求表 + requirement_tasks
 * 需求-任务双向关联表（W1.2）。
 *
 * requirements：
 * - acceptance_criteria 结构化验收条目 JSON：`[{ id, statement, status }]`（默认 '[]'）
 * - UNIQUE(project_id, code) 项目内需求编号唯一
 * - category / priority / status 带 CHECK 约束（对应帕累托与 RTM 聚合维度）
 *
 * requirement_tasks：
 * - 双向关联需求与任务（两侧均 ON DELETE CASCADE）
 * - UNIQUE(requirement_id, task_id) 防重复绑定；显式 task_id 索引（反查）
 * - 关联表按 design 只含 created_at（无 updated_at 语义）
 *
 * 方言兼容：无 `.after()`；索引显式命名（≤ PostgreSQL 63 字节）。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('requirements', (table) => {
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

      table.string('code', 64).notNullable()
      table.string('title', 255).notNullable()
      table.text('description').nullable()

      // 分类：business/user/functional/non_functional/other
      table.string('category', 64).notNullable().defaultTo('functional')
      table.check("category IN ('business','user','functional','non_functional','other')")

      // 优先级：lowest/low/medium/high/highest
      table.string('priority', 20).notNullable().defaultTo('medium')
      table.check("priority IN ('lowest','low','medium','high','highest')")

      // 状态机：draft/approved/in_progress/completed/cancelled
      table.string('status', 20).notNullable().defaultTo('draft')
      table.check("status IN ('draft','approved','in_progress','completed','cancelled')")

      // 结构化验收条目 JSON 数组
      table.json('acceptance_criteria').notNullable().defaultTo('[]')

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
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 约束与索引
      table.unique(['project_id', 'code'])
      table.index(
        ['organization_id', 'project_id', 'status'],
        'idx_requirements_org_project_status',
      )
    })

    this.schema.createTable('requirement_tasks', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('requirement_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('requirements')
        .onDelete('CASCADE')

      table
        .bigInteger('task_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')

      table.timestamp('created_at').notNullable()

      // 双向防重复 + 反查索引
      table.unique(['requirement_id', 'task_id'])
      table.index(['task_id'], 'idx_requirement_tasks_task_id')
    })
  }

  async down() {
    this.schema.dropTable('requirement_tasks')
    this.schema.dropTable('requirements')
  }
}
