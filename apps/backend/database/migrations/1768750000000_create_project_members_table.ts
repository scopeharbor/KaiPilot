import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * project_members 表：项目与用户的多对多关联（sec7.1.2）。
 * - project_id → projects ON DELETE CASCADE
 * - project_role_id → project_roles ON DELETE SET NULL（待分配角色时为 NULL）
 * - 联合唯一 (project_id, user_id)
 * 关联表，不软删除（design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'project_members'

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

      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 角色为 NULL 表示待分配
      table
        .bigInteger('project_role_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('project_roles')
        .onDelete('SET NULL')

      // 控制成员是否有效（临时禁用而非删除）
      table.boolean('is_active').notNullable().defaultTo(true)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 联合唯一：同一用户不能重复加入同一项目
      table.unique(['project_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
