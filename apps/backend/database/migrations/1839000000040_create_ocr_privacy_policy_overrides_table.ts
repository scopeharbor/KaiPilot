/**
 * Migration: create_ocr_privacy_policy_overrides_table
 * 创建 OCR 隐私策略覆盖表（v3-ocr-privacy-policy-controls §3.1）
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_privacy_policy_overrides'

  public async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').notNullable()
      table.integer('project_id').nullable()
      table.json('policy_json').notNullable().defaultTo('{}')
      table.integer('version').notNullable().defaultTo(1)
      table.string('policy_hash', 64).notNullable()
      table.string('source', 20).notNullable()
      table.string('status', 20).notNullable().defaultTo('active')
      table.integer('updated_by').nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).notNullable()
    })

    // 索引
    this.schema.raw(
      'CREATE INDEX idx_ocr_privacy_policy_overrides_org_proj ON ocr_privacy_policy_overrides(organization_id, project_id)',
    )
    this.schema.raw(
      "CREATE UNIQUE INDEX idx_ocr_privacy_policy_overrides_active ON ocr_privacy_policy_overrides(organization_id, project_id) WHERE status = 'active'",
    )
    this.schema.raw(
      'CREATE INDEX idx_ocr_privacy_policy_overrides_hash ON ocr_privacy_policy_overrides(policy_hash)',
    )
  }

  public async down() {
    this.schema.dropTable(this.tableName)
  }
}
