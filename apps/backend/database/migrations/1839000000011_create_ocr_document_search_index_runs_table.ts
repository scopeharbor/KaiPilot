import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * OCR Document Search Index Runs — 索引运行记录表 (v3-ocr-document-search-indexing §3.2)
 *
 * 记录每次 index/reindex/unindex 运行的元数据：类型、状态、预览哈希、
 * idempotency key 哈希、计数、警告 JSON、低敏元数据。
 * 组织+项目隔离，不存储完整 OCR 文本或搜索内容。
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_document_search_index_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // 组织 + 项目隔离
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()

      // 运行类型与状态
      table.string('run_type', 16).notNullable()
      table.string('status', 16).notNullable()

      // 预览/幂等
      table.string('preview_hash', 64).nullable()
      table.string('idempotency_key_hash', 64).nullable()

      // 计数
      table.integer('entry_count').unsigned().notNullable().defaultTo(0)
      table.integer('blocked_count').unsigned().notNullable().defaultTo(0)
      table.integer('warning_count').unsigned().notNullable().defaultTo(0)

      // 警告与阻塞原因 (JSON)
      table.text('warnings_json').notNullable().defaultTo('[]')
      table.text('blocked_reasons_json').notNullable().defaultTo('[]')

      // 低敏备注
      table.string('note', 500).nullable()

      // 操作人
      table.integer('run_by').unsigned().nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_search_run_org_project')
      table.index(['run_type', 'status'], 'ocr_search_run_type_status')
      table.index(['idempotency_key_hash'], 'ocr_search_run_idem_hash')
      table.index(['preview_hash'], 'ocr_search_run_preview_hash')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
