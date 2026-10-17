import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-pwa-web-push-notifications -- PWA Web Push 订阅表（design D2）。
 *
 * 组织/用户隔离的推送订阅记录。
 * endpoint 用 SHA-256 哈希存 endpoint_hash（唯一约束，不暴露原始 endpoint），
 * endpoint/keys 用 AES-GCM 密文存（通过 push_subscription_cipher），
 * 明文永不入库/响应/审计/日志。status 支持 active/revoked/invalidated 生命周期。
 * 唯一 active endpoint 约束：同一 endpoint 在组织/用户内只能有一条 active 记录。
 */
export default class extends BaseSchema {
  protected tableName = 'pwa_push_subscriptions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      // endpoint SHA-256 哈希（唯一约束，不暴露原始 endpoint）
      table.string('endpoint_hash', 64).notNullable()
      // AES-GCM 密文：原始 endpoint
      table.text('endpoint_ciphertext').notNullable()
      // AES-GCM 密文：p256dh key
      table.text('p256dh_ciphertext').notNullable()
      // AES-GCM 密文：auth key
      table.text('auth_ciphertext').notNullable()
      // 订阅状态：active | revoked | invalidated
      table.string('status', 16).notNullable().defaultTo('active')
      // 用户代理摘要（用于 UI 展示，非敏感）
      table.string('user_agent', 255).nullable()
      // 用户代理哈希（轻量指纹）
      table.string('user_agent_hash', 64).nullable()
      // 最后活跃时间
      table.timestamp('last_seen_at').nullable()
      // 撤销时间（用户手动取消订阅）
      table.timestamp('revoked_at').nullable()
      // 失效时间（endpoint 不再可用）
      table.timestamp('invalidated_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 组织内用户订阅查询
      table.index(['organization_id', 'user_id', 'status'])
      // 唯一 active endpoint（同一 endpoint 在组织/用户内只能有一条 active）
      table.unique(
        ['organization_id', 'user_id', 'endpoint_hash'],
        'pwa_push_active_endpoint_unique',
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
