/**
 * document_search_entries 表：文档全文搜索索引派生表（v3-document-full-text-search §3.1）。
 *
 * - organization_id + project_id + document_id 唯一约束
 * - content_text 为 documents.content 去 Markdown 后的有界投影
 * - content_hash 用于幂等跳过
 * - lifecycle: 'active' | 'orphaned'
 * - deleted_at 冗余软删除标记，Adapter 查询强制 IS NULL
 * - 外键 ON DELETE CASCADE：删文档级联删索引行
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'document_search_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()

      table
        .bigInteger('document_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('documents')
        .onDelete('CASCADE')

      table.string('title', 500).notNullable()

      table.string('content_hash', 64).notNullable()

      table.text('content_text').nullable()

      table.integer('content_length').notNullable().defaultTo(0)

      table.boolean('truncated').notNullable().defaultTo(false)

      table.integer('version').notNullable().defaultTo(1)

      table.string('lifecycle', 20).notNullable().defaultTo('active')
      table.check("lifecycle IN ('active','orphaned')")

      table.timestamp('deleted_at').nullable()

      table.timestamp('indexed_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'lifecycle'], 'dse_org_proj_life_idx')
      table.unique(['project_id', 'document_id'], 'dse_proj_doc_unique')
      table.index(['content_hash'], 'dse_content_hash_idx')
      table.index(['document_id'], 'dse_document_id_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
