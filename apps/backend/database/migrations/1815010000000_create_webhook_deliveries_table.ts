import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-provider-incoming-webhook-foundation —— 入站投递账本（低敏）。
 *
 * 每条到达的交付无论通过与否恰好写一条（design D5）。**不存原始敏感 payload 全文**，
 * 仅存脱敏摘要/哈希（payload_digest）。组织隔离；以
 * `(organization_id, endpoint_id, idempotency_key)` 复合唯一在 DB 层兜底并发去重
 * （design D3）。字段名沿用 snake_case 与既有迁移一致。
 */
export default class extends BaseSchema {
  protected tableName = 'webhook_deliveries'

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
        .integer('endpoint_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('webhook_endpoints')
        .onDelete('CASCADE')
      table.string('provider', 40).notNullable()
      // provider delivery id（如 GitHub X-GitHub-Delivery）或计算确定性幂等键
      table.string('idempotency_key', 128).notNullable()
      table.string('event_type', 120).nullable()
      // 校验/去重结果枚举（字符串，受应用层校验）
      table.string('signature_result', 24).notNullable()
      table.string('timestamp_result', 24).notNullable()
      table.string('dedup_result', 24).notNullable()
      // payload 脱敏摘要/哈希（sha256 hex 或脱敏后截断摘要），原始敏感 payload 不落库
      table.string('payload_digest', 128).nullable()
      table.timestamp('received_at').notNullable()
      table.timestamp('created_at').notNullable()

      // 并发兜底：同组织+端点+幂等键唯一
      table.unique(['organization_id', 'endpoint_id', 'idempotency_key'])
      // 按组织+provider+时间查询账本
      table.index(['organization_id', 'provider', 'received_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
