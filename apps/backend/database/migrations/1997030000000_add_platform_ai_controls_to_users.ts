import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 平台统一 AI 配置 —— users 增加两列账号级开关。
 *
 * - `allow_self_ai_config`：个人版（free 组织）用户是否可自行配置 AI 连接。
 *   默认 false：个人版一律使用平台管理员统一配置的连接，入口隐藏、写接口拒绝；
 *   平台管理员可在「用户管理」里按账号逐个开启。
 * - `two_factor_exempt`：登录期跳过两步验证（绑定引导与校验）。只由部署机上的
 *   `node ace admin:create-super` 写入，没有任何 HTTP 接口能改它。
 *
 * 方言兼容：boolean + defaultTo(false)，SQLite 落 0/1、PostgreSQL 落 boolean，不加 `.after()`。
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  // 与 1769000000000 同一处理：down() 的 dropColumn 在 SQLite 下会重建 users 表，
  // 此时引用 users 的表都还在，外键开启会令重建的 DROP TABLE 失败
  // （实测单独运行 db_schema 测试组时回滚即报 FOREIGN KEY constraint failed）。
  // 事务内 PRAGMA foreign_keys 被忽略，故禁用事务后再临时关闭外键。
  static disableTransactions = true

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('allow_self_ai_config').notNullable().defaultTo(false)
      table.boolean('two_factor_exempt').notNullable().defaultTo(false)
    })
  }

  async down() {
    const dialect = this.db.dialect.name
    if (dialect === 'sqlite3') {
      this.schema.raw('PRAGMA foreign_keys = OFF')
    }
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('allow_self_ai_config')
      table.dropColumn('two_factor_exempt')
    })
    if (dialect === 'sqlite3') {
      this.schema.raw('PRAGMA foreign_keys = ON')
    }
  }
}
