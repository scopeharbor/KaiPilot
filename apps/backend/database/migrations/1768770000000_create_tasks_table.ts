import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * tasks 表：数据量最大的业务表，甘特图 / 看板 / WBS 多视图核心数据源（sec7.1.3）。
 * - project_id → projects ON DELETE CASCADE
 * - parent_task_id 自引用 ON DELETE CASCADE（删除父任务级联子任务）
 * - assignee_id / reviewer_id → users ON DELETE SET NULL
 * - milestone_id → milestones ON DELETE SET NULL
 * - wbs_node_id 仅建列，外键由 wbs_nodes 迁移补加（循环外键 SET NULL）
 * - 金额字段以「分」整数存储（design D7 / DEBT-01）
 * 软删除（sec7.5）。
 */
export default class extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 基础字段
      table.string('name', 255).notNullable()
      table.text('description').nullable()

      // 状态机：not_started/in_progress/completed/blocked/on_hold/cancelled
      table.string('status', 20).notNullable().defaultTo('not_started')
      table.check(
        "status IN ('not_started','in_progress','completed','blocked','on_hold','cancelled')",
      )

      // 优先级：lowest/low/medium/highest
      table.string('priority', 20).notNullable().defaultTo('medium')
      table.check("priority IN ('lowest','low','medium','high','highest')")

      // 任务类型：影响视图渲染与汇总规则
      table.string('task_type', 20).notNullable().defaultTo('task')
      table.check("task_type IN ('task','milestone','summary','deliverable')")

      // 日期与工期
      table.date('start_date').nullable()
      table.date('end_date').nullable()
      table.date('actual_start_date').nullable()
      table.date('actual_end_date').nullable()
      table.integer('duration_days').nullable()
      table.integer('estimated_hours').nullable()
      table.integer('actual_hours').nullable()

      // TODO-DEBT: DEBT-01 — 金额字段 V1 以「分」整数存储，V2 迁 PG 改 NUMERIC(15,2)。
      table.bigInteger('cost_estimate_cents').nullable()
      table.bigInteger('cost_actual_cents').nullable()

      // 人员字段
      table
        .bigInteger('assignee_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .bigInteger('reviewer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 层级字段：自引用构建任务树
      table
        .bigInteger('parent_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')

      // wbs_node_id 外键由 wbs_nodes 迁移补加（SET NULL）
      table.bigInteger('wbs_node_id').unsigned().nullable()
      table
        .bigInteger('milestone_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('milestones')
        .onDelete('SET NULL')

      // CPM 关键路径计算字段
      table.boolean('is_critical_path').notNullable().defaultTo(false)
      table.boolean('is_on_longest_path').notNullable().defaultTo(false)
      table.date('earliest_start').nullable()
      table.date('earliest_finish').nullable()
      table.date('latest_start').nullable()
      table.date('latest_finish').nullable()
      // 浮动时间（整数，单位为天）
      table.integer('total_float').nullable()
      table.integer('free_float').nullable()
      // CPM 最后计算时间戳（判断缓存有效性）
      table.timestamp('cpm_calculated_at').nullable()

      // 扩展字段
      table.json('ai_metadata').nullable()
      table.json('custom_fields').nullable()

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：甘特图日期范围、看板状态过滤、用户任务、子任务树（sec7.5）
      table.index(['project_id'])
      table.index(['project_id', 'status'])
      table.index(['project_id', 'start_date', 'end_date'])
      table.index(['assignee_id'])
      table.index(['parent_task_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
