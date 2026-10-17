import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ai_connections 表：用户可配置的 AI 模型连接（ai-gateway-abstraction / T034）。
 *
 * 每条连接 = { protocol, baseURL, apiKey(加密), model }，组织级隔离。
 * - organization_id → organizations ON DELETE CASCADE
 * - api_key_encrypted：AES-256-GCM 密文（text，加密后含 IV+tag+密文，较长），永不回前端明文
 * - capabilities：运行时探测的端点能力（strict schema / tool / streaming tool），用于策略降级
 * - sync_state：产品 DB(权威) → Bifrost sidecar 的同步状态
 *
 * 红线：API key 仅后端加解密；Bifrost 仅 localhost（design D5）。
 * 兼容 SQLite / PostgreSQL（DEBT-01）。
 */
export default class extends BaseSchema {
  protected tableName = 'ai_connections'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('display_name', 120).notNullable()

      // 协议：本产品只抽象两种协议（design「Provider vs Protocol」结论）。
      table.string('protocol', 30).notNullable()
      table.check("protocol IN ('openai_compatible','anthropic_compatible')")

      // baseURL 可空：空 = 该协议默认官方端点（OpenAI / Anthropic 官方）。
      table.string('base_url', 512).nullable()

      // AES-256-GCM 密文（iv(12) + 加密内容 + tag(16)，base64 后约明文 1.6x），text 容纳。
      table.text('api_key_encrypted').nullable()

      table.string('model', 200).notNullable()

      // 端点能力探测结果（strict schema / tool / streaming tool 可用性），策略降级依据。
      table.json('capabilities').nullable()

      // 产品 DB → Bifrost sidecar 同步状态。
      table.string('sync_state', 20).notNullable().defaultTo('pending')
      table.check("sync_state IN ('pending','synced','error','disabled')")

      table.boolean('is_active').notNullable().defaultTo(true)

      table.timestamp('last_tested_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'is_active'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
