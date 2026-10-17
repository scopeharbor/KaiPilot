import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-resource-gap-analysis §6.2 / §11.2: resource_gap_snapshots 派生缓存表。
 *
 * 默认启用。存储预聚合缺口摘要以降低 P95 延迟。
 * 源签名 + 授权指纹实现缓存失效。
 */
export default class extends BaseSchema {
  protected tableName = 'resource_gap_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('organizations.id')
        .onDelete('CASCADE')
      table.integer('actor_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')

      // 缓存键（query shape hash + org + actor）
      table.string('cache_key', 64).notNullable().unique()

      // 缺口摘要 JSON（低敏：仅含 gapId / severity / dimension / metric / gapHours / reasons）
      table.text('payload').notNullable()

      // 源签名：基于上游数据版本计算，用于缓存失效
      table.string('source_signature', 64).notNullable()

      // 授权指纹：基于 actor RBAC 权限计算，用于缓存失效
      table.string('auth_fingerprint', 64).notNullable()

      // 指标版本
      table.string('metric_version', 32).notNullable().defaultTo('resource-gap-analysis@1')

      // 有效期（秒），超期自动失效
      table.integer('ttl_seconds').unsigned().notNullable().defaultTo(300)

      // 是否因上游不可用而降级
      table.boolean('degraded').notNullable().defaultTo(false)

      // 降级原因码列表
      table.text('degraded_reasons').nullable()

      table.timestamp('calculated_at').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'cache_key'])
      table.index(['organization_id', 'expires_at'])
      table.index(['source_signature'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
