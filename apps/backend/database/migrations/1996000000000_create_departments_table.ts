import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— departments 组织分解结构部门树表（W1.1）。
 *
 * - organization_id → organizations ON DELETE CASCADE（租户物理隔离）
 * - parent_id 自引用 ON DELETE RESTRICT（有子部门的节点禁止物理删除）
 * - leader_id → users ON DELETE SET NULL；created_by → users ON DELETE RESTRICT
 * - path 为物化路径（如 `/1/4/12/`），depth 为层级深度（根为 0），服务层维护
 * - UNIQUE(organization_id, code) 防止同租户内部门编码重复
 *
 * 方言兼容：无 `.after()`（SQLite 不支持列定位）；索引显式命名（≤ PostgreSQL 63 字节）。
 */
export default class extends BaseSchema {
  protected tableName = 'departments'

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

      // 自引用父部门：有子部门时禁止删除父部门
      table
        .bigInteger('parent_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('departments')
        .onDelete('RESTRICT')

      table.string('name', 128).notNullable()
      table.string('code', 64).notNullable()
      table.text('description').nullable()

      // 部门负责人：账号删除时置空
      table
        .bigInteger('leader_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.integer('sort_order').notNullable().defaultTo(0)

      // 树形物化路径与深度（服务层写入）
      table.string('path', 255).notNullable()
      table.integer('depth').notNullable().defaultTo(0)

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      // 软删除 + 时间戳
      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 约束与索引
      table.unique(['organization_id', 'code'])
      table.index(['organization_id', 'path'], 'idx_departments_org_path')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
