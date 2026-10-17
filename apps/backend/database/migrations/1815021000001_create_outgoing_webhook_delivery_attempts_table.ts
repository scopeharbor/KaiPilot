import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递尝试表（design D1/D4）。
 *
 * 每次发送尝试对应一条 append-only 记录。持有尝试号、调度/开始/完成时间、状态、
 * 低敏失败分类、响应状态码、响应体哈希或有限安全摘要、重试原因。
 * 不存完整响应体、签名值、请求头、密钥、token、authorization（design D1/D2 红线）。
 * organization_id 冗余便于组织隔离查询，与 delivery_event 一致。
 */
export default class extends BaseSchema {
  protected tableName = 'outgoing_webhook_delivery_attempts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('delivery_event_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('outgoing_webhook_delivery_events')
        .onDelete('CASCADE')
      // 冗余组织字段，便于隔离查询与跨组织隐藏
      table.integer('organization_id').unsigned().notNullable()
      table.integer('attempt_number').unsigned().notNullable()
      // 'scheduled' | 'in_progress' | 'success' | 'failed'
      table.string('status', 16).notNullable()
      table.timestamp('scheduled_at').notNullable()
      table.timestamp('started_at').nullable()
      table.timestamp('completed_at').nullable()
      table.integer('response_status').nullable()
      table.string('failure_category', 32).nullable()
      // 响应体哈希（不可还原内容）
      table.string('response_body_hash', 128).nullable()
      // 有限安全摘要（截断，低敏）
      table.string('response_excerpt', 255).nullable()
      table.string('retry_reason', 255).nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 唯一约束显式短名（v3-docker-compose-runtime-foundation 第七轮真实 GCP fresh PG 证据）：
      // knex 自动名 outgoing_webhook_delivery_attempts_delivery_event_id_attempt_number_unique
      // 74 字节，PG 63-byte 截断后与普通索引自动名（73 字节）同截断为
      // outgoing_webhook_delivery_attempts_delivery_event_id_attempt_nu，create index 撞名 exit 1。
      // 原 table.index(['delivery_event_id','attempt_number']) 与 unique 同列同序，UNIQUE 的
      // B-tree backing index 完全覆盖其查询语义（listAttempts 的 delivery_event_id 等值 +
      // attempt_number 排序、并发防重由 unique 承担），属冗余索引，按显式命名裁决移除。
      table.unique(['delivery_event_id', 'attempt_number'], 'uq_owda_event_attempt')
      // organization_id 索引自动名 56 字节，低于 63 上限，保留自动命名。
      table.index('organization_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
