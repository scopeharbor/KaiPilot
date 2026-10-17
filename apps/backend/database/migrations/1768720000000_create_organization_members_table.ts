import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * organization_members 表：用户与组织的多对多关联（sec7.1.1）。
 * - 随组织删除级联（CASCADE）
 * - invited_by → users ON DELETE SET NULL（保留被邀请成员数据完整性）
 * - 联合唯一 (organization_id, user_id) 防重复加入
 * 关联表，不软删除（design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'organization_members'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 随组织删除而级联删除
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 成员用户：用户删除时移除其成员关系（关联表物理删除）
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 组织角色：owner / admin / member / viewer（与项目级角色正交）
      table.string('role', 20).notNullable().defaultTo('member')
      table.check("role IN ('owner','admin','member','viewer')")

      // 自定义权限列表（细粒度 RBAC 预留）
      table.json('permissions').nullable()

      // 邀请人：邀请人账号删除时置空
      table
        .bigInteger('invited_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 联合唯一：同一用户不能重复加入同一组织
      table.unique(['organization_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
