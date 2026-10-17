import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * OCR Document Search Index Entries — 文档搜索索引入口表 (v3-ocr-document-search-indexing §3.1)
 *
 * 存储被显式确认索引的 OCR accepted extraction 的搜索条目。
 * 组织+项目隔离，支持 active/inactive/tombstoned 生命周期。
 * uniqueness guard 保证同一 extraction 只有一个活跃条目。
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_document_search_index_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // 组织 + 项目隔离
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()

      // 源提取
      table.integer('extraction_id').unsigned().notNullable()

      // 源信息
      table.string('source_kind', 32).notNullable().defaultTo('unknown')
      table.integer('source_id').unsigned().nullable()

      // 哈希追踪
      table.string('source_hash', 64).notNullable()
      table.string('selected_text_hash', 64).notNullable()
      table.string('index_content_hash', 64).notNullable()

      // 页码引用 (JSON)
      table.text('page_refs_json').notNullable().defaultTo('[]')

      // 搜索文本 (截断至上限)
      table.text('searchable_text').notNullable()
      table.text('searchable_snippet').nullable()

      // 生命周期状态
      table.string('status', 16).notNullable().defaultTo('active')

      // 操作人追踪
      table.integer('indexed_by').unsigned().nullable()
      table.timestamp('indexed_at', { useTz: true }).nullable()
      table.integer('tombstoned_by').unsigned().nullable()
      table.timestamp('tombstoned_at', { useTz: true }).nullable()

      // 关联的索引运行
      table.integer('last_run_id').unsigned().nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_search_idx_org_project')
      table.index(['organization_id', 'project_id', 'status'], 'ocr_search_idx_org_project_status')
      table.index(['extraction_id'], 'ocr_search_idx_extraction')
      table.index(['source_kind', 'source_id'], 'ocr_search_idx_source')
      table.index(['status'], 'ocr_search_idx_status')
      table.index(['index_content_hash'], 'ocr_search_idx_content_hash')

      // Uniqueness: 同一 extraction 只有一个 active 条目
      table.unique(['extraction_id', 'status'], {
        indexName: 'ocr_search_idx_unique_active_extraction',
      })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
