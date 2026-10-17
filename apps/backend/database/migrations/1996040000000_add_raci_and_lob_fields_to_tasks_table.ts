import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— tasks 表补齐 RACI 与 LOB 维度（W1.2）。
 *
 * - consulted_user_ids / informed_user_ids：JSON 数字数组（默认 '[]'，模型层
 *   prepare/consume 序列化），支撑项目级 RACI 矩阵 Consulted/Informed 两维
 * - location_unit / cycle_stage：线条平衡图（LOB）物理空间单元与流水工序阶段
 *
 * 方言兼容（design D1-§3）：
 * - 不使用 `.after()`（SQLite 不支持列定位），新列直接追加在表尾；
 * - 既有行由 DEFAULT '[]' 回填，NOT NULL 在 SQLite / PostgreSQL 均安全；
 * - 复合索引显式命名 idx_tasks_project_location。
 */
export default class extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('consulted_user_ids').notNullable().defaultTo('[]')
      table.json('informed_user_ids').notNullable().defaultTo('[]')
      table.string('location_unit', 64).nullable()
      table.string('cycle_stage', 64).nullable()
      table.index(['project_id', 'location_unit'], 'idx_tasks_project_location')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['project_id', 'location_unit'], 'idx_tasks_project_location')
      table.dropColumn('consulted_user_ids')
      table.dropColumn('informed_user_ids')
      table.dropColumn('location_unit')
      table.dropColumn('cycle_stage')
    })
  }
}
