import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-llm-wiki-rag-retirement —— 评测记录种类：`retrieval`（检索层，默认，不调用模型）/ `answer`（答案层，经组织 AI 连接生成回答）。
 * 答案层另记消耗的 token 与模型名；仍只存汇总与哈希，不存题目与回答原文。
 */
export default class extends BaseSchema {
  protected tableName = 'wiki_eval_runs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('eval_kind', 16).notNullable().defaultTo('retrieval')
      table.integer('tokens_used').notNullable().defaultTo(0)
      table.string('model_name', 120).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('model_name')
      table.dropColumn('tokens_used')
      table.dropColumn('eval_kind')
    })
  }
}
