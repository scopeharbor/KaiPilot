import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-llm-wiki-query-navigation —— 维基上下文包影子记录。只存统计与问题哈希，
 * 不存问题原文、主张内容或页面正文；影子结果从不注入模型。
 */
export default class extends BaseSchema {
  protected tableName = 'wiki_context_shadow_records'

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
      table.bigInteger('project_id').unsigned().nullable()
      table
        .bigInteger('actor_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('query_hash', 64).notNullable()
      table.integer('pages_count').notNullable().defaultTo(0)
      table.integer('claims_count').notNullable().defaultTo(0)
      table.integer('bytes').notNullable().defaultTo(0)
      table.boolean('truncated').notNullable().defaultTo(false)
      table.integer('legacy_sources_count').notNullable().defaultTo(0)
      table.integer('legacy_facts_count').notNullable().defaultTo(0)
      table.integer('duration_ms').notNullable().defaultTo(0)
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['organization_id', 'created_at'], 'wiki_ctx_shadow_org_created_index')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
