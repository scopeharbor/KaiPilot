import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递事件表（design D1）。
 *
 * 每条订阅匹配的域事件对应一条投递事件（outbox/ledger 主体）。持有低敏 canonical payload、
 * 组织/订阅范围、事件类型、源实体引用、幂等键、投递状态、重试元数据、暂停标记。
 * 不存密钥明文/密文/签名值/完整响应体/prompt/输出/token（敏感字段一律不落本表）。
 * payload 为低敏 canonical JSON（builder + assert 保证仅白名单字段），重试时复用同一签名。
 */
export default class extends BaseSchema {
  protected tableName = 'outgoing_webhook_delivery_events'

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
      // 'project.updated' | 'task.created' | 'task.updated' | 'task.completed' | 'risk.created'
      table.string('event_type', 64).notNullable()
      // 'project' | 'task' | 'risk'
      table.string('source_entity_type', 16).notNullable()
      table.integer('source_entity_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      // 稳定幂等键：wh-evt-<org>-<sub>-<event>-<sourceHash>
      table.string('idempotency_key', 160).notNullable()
      // 'pending' | 'in_progress' | 'success' | 'failed' | 'paused'
      table.string('status', 16).notNullable().defaultTo('pending')
      table.integer('attempt_count').unsigned().notNullable().defaultTo(0)
      table.integer('max_attempts').unsigned().notNullable().defaultTo(5)
      table.string('last_attempt_status', 16).nullable()
      table.timestamp('last_attempt_at').nullable()
      table.timestamp('next_attempt_at').nullable()
      table.string('failure_category', 32).nullable()
      table.string('terminal_failure_reason', 255).nullable()
      table.boolean('paused').notNullable().defaultTo(false)
      // 低敏 canonical payload（仅白名单字段，签名可复现）
      table.text('payload').notNullable()
      // 信封 timestamp（签名固定输入，重试不变）
      table.string('envelope_timestamp', 64).notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 幂等：同组织同幂等键唯一，重复源事件复用
      table.unique(['organization_id', 'idempotency_key'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'subscription_id'])
      // runner due 查询
      table.index('next_attempt_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
