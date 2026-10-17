import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 扩展 users 表：增加全局系统管理员标识与角色版本号。
 *
 * `is_super_admin` 承载跨组织的系统管理员角色（sec11）。
 * `role_version` 用于角色/成员关系变更后即时令旧 JWT access token 失效：
 * auth_middleware 每请求比对 token 内 role_version 与 DB 当前值，不一致即拒绝。
 *
 * v2-postgresql-migration-foundation（DEBT-01）：PG 迁移兼容性。
 * SQLite 需要 PRAGMA 临时关闭外键以支持 dropColumn 表重建；
 * PG 使用 ALTER TABLE DROP COLUMN 直接删除列，不需要 PRAGMA 或表重建。
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  // 关闭事务：down() 用 dropColumn 在 SQLite 下会重建 users 表，
  // 而本迁移为最新迁移、回滚时最先执行——此时 organizations 等依赖表尚在，
  // FK 开启会令重建的 DROP TABLE 步骤失败。事务内 PRAGMA foreign_keys 被忽略，
  // 故禁用事务后再临时关闭 FK（up 仅 ADD COLUMN，无重建、不受影响）。
  static disableTransactions = true

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_super_admin').notNullable().defaultTo(false)
      table.integer('role_version').notNullable().defaultTo(0)
    })
  }

  async down() {
    // SQLite：dropColumn 触发表重建，需先临时关闭外键。
    // PG：ALTER TABLE DROP COLUMN 直接操作，不需要 PRAGMA。
    const dialect = this.db.dialect.name
    if (dialect === 'sqlite3') {
      this.schema.raw('PRAGMA foreign_keys = OFF')
    }
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumns('is_super_admin', 'role_version')
    })
    if (dialect === 'sqlite3') {
      this.schema.raw('PRAGMA foreign_keys = ON')
    }
  }
}
