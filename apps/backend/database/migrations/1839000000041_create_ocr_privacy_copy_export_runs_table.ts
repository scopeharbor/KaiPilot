/**
 * Migration: create_ocr_privacy_copy_export_runs_table
 * 创建 OCR 隐私复制/导出运行记录表（v3-ocr-privacy-policy-controls §3.2）
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_privacy_copy_export_runs'

  public async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.string('run_key', 64).notNullable()
      table.integer('organization_id').notNullable()
      table.integer('project_id').notNullable()
      table.string('source_scope_kind', 30).notNullable()
      table.string('purpose', 30).notNullable()
      table.string('format', 20).notNullable()
      table.string('preview_hash', 64).notNullable()
      table.string('policy_hash', 64).notNullable()
      table.string('status', 20).notNullable().defaultTo('previewed')
      table.string('output_mode', 20).notNullable().defaultTo('metadata_only')
      table.integer('record_count').notNullable().defaultTo(0)
      table.integer('character_count').notNullable().defaultTo(0)
      table.integer('page_count').notNullable().defaultTo(0)
      table.json('content_hashes').notNullable().defaultTo('[]')
      table.json('warning_codes').notNullable().defaultTo('[]')
      table.integer('confirmed_by').nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).notNullable()
    })

    // 索引与约束
    this.schema.raw(
      'CREATE UNIQUE INDEX idx_ocr_privacy_runs_key ON ocr_privacy_copy_export_runs(run_key)',
    )
    this.schema.raw(
      'CREATE INDEX idx_ocr_privacy_runs_org_proj ON ocr_privacy_copy_export_runs(organization_id, project_id)',
    )
    this.schema.raw(
      'CREATE INDEX idx_ocr_privacy_runs_status ON ocr_privacy_copy_export_runs(status)',
    )
  }

  public async down() {
    this.schema.dropTable(this.tableName)
  }
}
