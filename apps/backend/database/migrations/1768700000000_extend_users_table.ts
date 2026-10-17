import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 扩展 users 表：补 sec7.1.1 规定的认证来源、偏好、状态与软删除字段。
 * 用 alterTable 迁移，保留既有 create_users 迁移不动（design D11）。
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // 认证来源：local / google / github / microsoft
      table.string('auth_provider', 30).notNullable().defaultTo('local')
      // 第三方平台用户 ID（local 认证时为 NULL）
      table.string('provider_id', 255).nullable()
      // 用户级配置（语言/主题等），JSON 存储（sec7 类型映射：SQLite TEXT / PG JSONB）
      table.json('preferences').nullable()
      // 账号可用状态
      table.boolean('is_active').notNullable().defaultTo(true)
      // 邮箱验证时间（注册 / 找回流程依赖）
      table.timestamp('email_verified_at').nullable()
      // 软删除（sec7.5 软删除策略）
      table.timestamp('deleted_at').nullable()

      // 联合唯一 (auth_provider, provider_id)：provider_id 可空，SQLite 多 NULL 不冲突
      table.unique(['auth_provider', 'provider_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['auth_provider', 'provider_id'])
      table.dropColumns(
        'auth_provider',
        'provider_id',
        'preferences',
        'is_active',
        'email_verified_at',
        'deleted_at',
      )
    })
  }
}
