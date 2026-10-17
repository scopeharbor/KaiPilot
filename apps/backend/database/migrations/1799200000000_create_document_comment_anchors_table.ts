import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 创建 document_comment_anchors 表。
 * 存储文档内联批注锚点元数据，关联 organization/project/document/root comment。
 */
export default class extends BaseSchema {
  protected tableName = 'document_comment_anchors'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()
      table.bigInteger('document_id').unsigned().notNullable()
      table.bigInteger('root_comment_id').unsigned().notNullable()

      // 锚点位置与版本证据
      table.string('document_version', 255).notNullable()
      table.string('content_hash', 64).notNullable()
      table.integer('range_start').unsigned().notNullable()
      table.integer('range_end').unsigned().notNullable()
      table.text('selected_quote').notNullable()

      // Snippet 哈希（前后缀各 64 字符）
      table.string('prefix_hash', 64).notNullable()
      table.string('suffix_hash', 64).notNullable()

      // 安全位置摘要
      table.string('heading_path', 400).nullable()

      // 失效状态
      table.string('stale_status', 64).notNullable().defaultTo('fresh')
      table.text('stale_reason').nullable()

      // 软隐藏（root comment 被删除时）
      table.boolean('is_hidden').notNullable().defaultTo(false)

      // 创建者
      table.bigInteger('created_by').unsigned().notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'project_id', 'document_id'], 'doc_anchor_org_proj_doc_idx')
      table.index(['root_comment_id'], 'doc_anchor_root_comment_idx')
      table.index(
        ['organization_id', 'project_id', 'document_id', 'stale_status'],
        'doc_anchor_stale_idx',
      )
      table.unique(
        ['document_id', 'content_hash', 'range_start', 'range_end'],
        'doc_anchor_dedupe_idx',
      )

      // 外键
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE')
      table.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE')
      table.foreign('document_id').references('id').inTable('documents').onDelete('CASCADE')
      table.foreign('root_comment_id').references('id').inTable('comments').onDelete('CASCADE')
      table.foreign('created_by').references('id').inTable('users').onDelete('CASCADE')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
