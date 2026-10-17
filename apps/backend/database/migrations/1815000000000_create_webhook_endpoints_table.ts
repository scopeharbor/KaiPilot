import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-provider-incoming-webhook-foundation —— per-provider 入站 webhook 端点表。
 *
 * 镜像 `1801000000000_create_integration_connections_table.ts` 风格：组织隔离
 * 外键 + 复合唯一 + 索引。签名密钥用 AES-GCM 密文落库（IntegrationTokenCipher），
 * 明文永不入库/响应/账本。`previous_secret_encrypted` + `secret_rotated_at`
 * 支持轮换过渡窗口（design D4）。
 */
export default class extends BaseSchema {
  protected tableName = 'webhook_endpoints'

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
      table.string('provider', 40).notNullable()
      table.string('slug', 80).notNullable()
      // AES-GCM 密文（IntegrationTokenCipher 输出：iv.tag.ciphertext，base64url）
      table.text('signing_secret_encrypted').notNullable()
      // 轮换过渡窗口期保留的旧密钥密文；窗口结束后 ingest 校验不再接受
      table.text('previous_secret_encrypted').nullable()
      table.timestamp('secret_rotated_at').nullable()
      // 时间戳新鲜度容差（秒），默认 ±300
      table.integer('timestamp_tolerance_seconds').unsigned().notNullable().defaultTo(300)
      table.boolean('enabled').notNullable().defaultTo(false)
      table
        .integer('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 同一组织+provider 下 slug 唯一
      table.unique(['organization_id', 'provider', 'slug'])
      // 管理查询：按组织+provider+启用状态筛选
      table.index(['organization_id', 'provider', 'enabled'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
