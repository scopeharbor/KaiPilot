import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-template-compiler-plugin-integration —— 为 compiler_runs 增加模板快照列（tasks 3.2）。
 *
 * template_snapshot JSON：不可变来源快照（pluginId/templateId/version/digests/seed）
 * template_selection_digest string：提交时的 selectionDigest，用于 TOCTOU 与 replay
 */
export default class extends BaseSchema {
  protected tableName = 'compiler_runs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('template_snapshot').nullable()
      table.string('template_selection_digest').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('template_snapshot')
      table.dropColumn('template_selection_digest')
    })
  }
}
