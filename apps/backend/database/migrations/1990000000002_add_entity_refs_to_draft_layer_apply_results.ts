import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-to-delivery-closed-loop —— ai_draft_layer_apply_results 增加 typed
 * entity receipt 列（tasks 4.1/4.2）。
 *
 * 向后兼容：nullable JSON；既有历史行为 null → 上层投影 `legacy_unlinked`，
 * 零数据迁移、零回填。有界：数组长度 ≤ operations 数（应用层校验）。
 */
export default class extends BaseSchema {
  protected tableName = 'ai_draft_layer_apply_results'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('entity_refs').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('entity_refs')
    })
  }
}
