import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * wbs_nodes 表：工作分解结构的无限嵌套树（sec7.1.3）。
 * - project_id → projects ON DELETE CASCADE
 * - parent_id 自引用 ON DELETE SET NULL（删除节点时子节点置为根级，避免误删整棵子树）
 * - task_id → tasks ON DELETE SET NULL；条件唯一（一个任务最多关联一个 WBS 节点）
 * - 材质化路径 path（如 /1/2/5/）加速树查询，规避递归 CTE 性能与深度限制
 * 软删除（sec7.5）。
 *
 * 本迁移同时补加两条循环外键（被引用表 wbs_nodes 在此刻才存在）：
 * - projects.wbs_root_id → wbs_nodes ON DELETE SET NULL
 * - tasks.wbs_node_id    → wbs_nodes ON DELETE SET NULL
 */
export default class extends BaseSchema {
  protected tableName = 'wbs_nodes'

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

      // 自引用：置空而非级联，保护子树
      table
        .bigInteger('parent_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('wbs_nodes')
        .onDelete('SET NULL')

      // 材质化路径，加速 LIKE '/1/2/%' 后代查询
      table.string('path', 500).nullable()
      // WBS 编码，如 1.2.3
      table.string('code', 100).nullable()
      table.string('name', 255).notNullable()
      table.integer('depth').notNullable().defaultTo(0)
      table.boolean('is_leaf').notNullable().defaultTo(true)
      // 前端折叠状态
      table.boolean('collapsed').notNullable().defaultTo(false)

      // 关联具体任务（SET NULL，任务删除后节点保留）
      table
        .bigInteger('task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')

      table.integer('display_order').notNullable().defaultTo(0)

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：WBS 树查询、子节点查询、材质化路径前缀匹配（sec7.5）
      table.index(['project_id'])
      table.index(['parent_id'])
      table.index(['path'])
      // 条件唯一：一个任务最多关联一个 WBS 节点（task_id 为 NULL 时 SQLite 允许多个 NULL）
      table.unique(['task_id'])
    })

    // 补加循环外键（projects / tasks 已先于本表创建，wbs_root_id / wbs_node_id 仅建了列）
    this.schema.alterTable('projects', (table) => {
      table.foreign('wbs_root_id').references('id').inTable('wbs_nodes').onDelete('SET NULL')
    })
    this.schema.alterTable('tasks', (table) => {
      table.foreign('wbs_node_id').references('id').inTable('wbs_nodes').onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable('tasks', (table) => {
      table.dropForeign(['wbs_node_id'])
    })
    this.schema.alterTable('projects', (table) => {
      table.dropForeign(['wbs_root_id'])
    })
    this.schema.dropTable(this.tableName)
  }
}
