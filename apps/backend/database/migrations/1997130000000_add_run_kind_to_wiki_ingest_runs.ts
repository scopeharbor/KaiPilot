import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-llm-wiki-process-reality —— 运行记录类别：`ingest`（项目编入，默认）/ `process_interpret`（流程页 AI 解读）。
 * 两类共用每日预算与单空间串行；取值由服务端写入并在代码中校验。
 */
export default class extends BaseSchema {
  protected tableName = 'wiki_ingest_runs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('run_kind', 24).notNullable().defaultTo('ingest')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('run_kind')
    })
  }
}
