import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-webhook-batched-delivery -- 出站 webhook 批量投递表（design D1/D4）。
 *
 * 每条批量投递对应一条记录。持有组织/订阅/目标 URL 范围、批量信封元数据、
 * 批量状态、逐项结果 JSON（脱敏）、重试元数据、暂停标记。
 * 不存密钥明文/密文/签名值/完整响应体/prompt/输出/token（design D2 红线）。
 * organization_id 冗余便于隔离查询。
 * 逐项结果以 JSON 数组存储（仅脱敏投影字段：deliveryEventId, idempotencyKey, outcome, failureCategory）。
 */
export default class extends BaseSchema {
  protected tableName = 'outgoing_webhook_batch_deliveries'

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
        .integer('subscription_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('outgoing_webhook_subscriptions')
        .onDelete('CASCADE')
      // 批量唯一标识（receiver-facing）
      table.string('batch_id', 80).notNullable().unique()
      // 目标 URL（发送时使用，脱敏投影不包含）
      table.string('target_url', 2048).notNullable()
      // 签名密钥指纹（分组键的一部分）
      table.string('signing_key_fingerprint', 64).notNullable()
      // 签名密钥版本
      table.string('signing_key_version', 16).notNullable()
      // 签名方案版本
      table.string('signature_scheme_version', 8).notNullable().defaultTo('v1')
      // 事件信封 schema 版本
      table.string('event_envelope_schema_version', 8).notNullable().defaultTo('v1')
      // 批量包含的事件类型 JSON 数组
      table.text('event_types').notNullable()
      // 批量包含的入口 delivery_event_id 列表 JSON 数组
      table.text('entry_ids').notNullable()
      // 批量状态：pending | in_progress | success | partial | failed | paused
      table.string('status', 16).notNullable().defaultTo('pending')
      // 批量入口总数
      table.integer('entry_count').unsigned().notNullable()
      table.integer('attempt_count').unsigned().notNullable().defaultTo(0)
      table.integer('max_attempts').unsigned().notNullable().defaultTo(5)
      // 上次尝试摘要（脱敏）
      table.string('last_attempt_summary', 255).nullable()
      table.string('last_attempt_status', 16).nullable()
      table.timestamp('last_attempt_at').nullable()
      table.timestamp('next_attempt_at').nullable()
      table.string('failure_category', 32).nullable()
      table.string('terminal_failure_reason', 255).nullable()
      table.boolean('paused').notNullable().defaultTo(false)
      // 批量创建时的规范 payload 大小（用于审计，非存储完整 payload）
      table.integer('payload_byte_size').unsigned().nullable()
      // 逐项结果 JSON 数组（脱敏投影）
      table.text('entry_outcomes').nullable()
      // 批量创建时间（窗口闭合参考）
      table.timestamp('batch_created_at').notNullable()
      // 窗口闭合时间
      table.timestamp('window_closed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'subscription_id'])
      table.index('next_attempt_at')
      table.index('batch_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
