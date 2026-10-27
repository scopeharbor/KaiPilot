import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-llm-wiki-eval-gate —— 维基评测记录。只存汇总、每题哈希与命中布尔、回测指标与门禁结论，
 * 不存题目原文、要点或上下文内容。
 */
export default class extends BaseSchema {
  protected tableName = 'wiki_eval_runs'

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
        .bigInteger('triggered_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('status', 16).notNullable()
      table.check("status IN ('passed','failed','insufficient')")
      table.integer('questions_count').notNullable().defaultTo(0)
      table.text('qa_json').notNullable()
      table.text('backtest_json').notNullable()
      table.text('reasons_json').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['organization_id', 'created_at'], 'wiki_eval_runs_org_created_index')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
