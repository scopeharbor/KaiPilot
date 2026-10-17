import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * documents 表：项目文档与知识管理（sec7.2.2）。
 * - project_id → projects ON DELETE CASCADE
 * - parent_id 自引用支持文件夹结构（SET NULL）
 * - document_type：folder / document / template
 * 软删除（sec7.5 / design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'documents'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 自引用文件夹结构
      table
        .bigInteger('parent_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('documents')
        .onDelete('SET NULL')

      table.string('name', 255).notNullable()

      table.string('document_type', 20).notNullable().defaultTo('document')
      table.check("document_type IN ('folder','document','template')")

      // Markdown 纯文本 + 结构化内容（V2 扩展块结构）
      table.text('content').nullable()
      table.json('content_json').nullable()
      table.integer('version').notNullable().defaultTo(1)

      table.boolean('is_template').notNullable().defaultTo(false)
      table.string('template_key', 100).nullable()
      table.boolean('ai_generated').notNullable().defaultTo(false)

      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：文档列表、文件夹内容、模板查找（sec7.5）
      table.index(['project_id'])
      table.index(['parent_id'])
      table.index(['template_key'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
