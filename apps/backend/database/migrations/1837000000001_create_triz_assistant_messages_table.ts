import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_assistant_messages 表：AI-TRIZ 助手消息记录
 * （v3-ai-triz-assistant §3.1–§3.3）。
 *
 * 每条消息属于一个 assistant run，只存低敏摘要。
 * 不存完整 prompt、完整模型输出、secret/token/Authorization header。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_assistant_messages'

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
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('run_db_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_assistant_runs')
        .onDelete('CASCADE')

      table.string('run_id', 64).notNullable()
      table.string('message_id', 64).notNullable().unique()
      table.string('role', 16).notNullable()
      table.check("role IN ('user','assistant','system')")

      table.string('content_summary', 1024).notNullable().defaultTo('')
      table.json('source_refs_json').notNullable().defaultTo('[]')

      table.timestamp('created_at').notNullable()

      // 索引（tam = triz assistant message）
      table.index(['run_id'], 'idx_tam_run_id')
      table.index(['organization_id', 'run_id'], 'idx_tam_org_run')
      table.index(['run_id', 'created_at'], 'idx_tam_run_created')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
