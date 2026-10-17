import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * organizations 表：多租户顶层隔离单元（sec7.1.1）。
 * owner_id → users ON DELETE RESTRICT（不能删除仍拥有组织的用户）。
 */
export default class extends BaseSchema {
  protected tableName = 'organizations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 所有者：RESTRICT 阻止删除仍拥有组织的用户
      table
        .bigInteger('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      table.string('name', 255).notNullable()
      // URL 路由用 slug，全局唯一
      table.string('slug', 120).notNullable().unique()
      // 套餐层级（控制 max_projects / max_members 配额）
      table.string('plan_tier', 30).notNullable().defaultTo('free')
      table.integer('max_projects').notNullable().defaultTo(10)
      table.integer('max_members').notNullable().defaultTo(20)
      // 组织级配置（工作流状态、字段模板等）
      table.json('settings').nullable()

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
