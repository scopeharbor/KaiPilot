import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * project_roles 表：项目内 RBAC 角色定义（sec7.1.2）。
 * 每个项目独立拥有角色实例；V1 预设 6 个系统角色（is_system=true）。
 * - project_id → projects ON DELETE CASCADE
 * - 联合唯一 (project_id, name)
 * 关联表，不软删除（design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'project_roles'

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

      table.string('name', 100).notNullable()
      table.text('description').nullable()
      // 权限标识数组，如 ["task:manage","wbs:edit"]
      table.json('permissions').nullable()
      // 预设系统角色禁止删除
      table.boolean('is_system').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 联合唯一：同项目内角色名唯一
      table.unique(['project_id', 'name'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
