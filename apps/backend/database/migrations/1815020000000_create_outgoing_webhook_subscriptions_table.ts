import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅表（design D1）。
 *
 * 订阅生命周期独立于投递账本：本表只存「配置 + 加密密钥 + 状态」，不存投递记录。
 * 密钥用 AES-GCM 密文（IntegrationTokenCipher），明文永不入库；secret_fingerprint
 * 为非密钥指纹（哈希前缀），供 UI 识别。目标 URL 规范化后存 target_url。
 * event_types 为 JSON 数组，仅允许白名单事件（service 层校验）。
 */
export default class extends BaseSchema {
  protected tableName = 'outgoing_webhook_subscriptions'

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
      // project_id 可选：保守默认组织级，仅当既有策略干净支持时才用项目级（design open question）
      table
        .integer('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table.string('name', 120).notNullable()
      // 规范化后的 HTTPS 目标 URL
      table.text('target_url').notNullable()
      // 白名单事件类型 JSON 数组
      table.json('event_types').notNullable()
      // 'active' | 'inactive'
      table.string('status', 16).notNullable().defaultTo('active')
      // AES-GCM 密文（IntegrationTokenCipher 输出）
      table.text('secret_ciphertext').notNullable()
      // 非密钥指纹（哈希前缀，不可还原）
      table.string('secret_fingerprint', 32).notNullable()
      table
        .integer('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('last_rotated_at').nullable()
      table.timestamp('deactivated_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 组织内订阅查询
      table.index(['organization_id', 'status'])
      // 组织内名称唯一，避免配置混淆
      table.unique(['organization_id', 'name'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
