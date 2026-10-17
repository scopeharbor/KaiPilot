/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer Previews 表（task 2.3）。
 *
 * 保存 PDM 到正式业务实体的预览快照（baseline / current / preview 摘要 + hash）。
 * computed_from_change_ids 记录该 preview 对应的 change id 集合。
 * 组织隔离通过 session_id → session → organization_id 间接实现。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_draft_layer_previews', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_draft_layer_sessions')
        .onDelete('CASCADE')

      table.integer('version').notNullable().defaultTo(1)

      table.json('baseline_summary').nullable()
      table.json('current_summary').nullable()

      table.string('preview_hash', 64).notNullable()
      table.json('computed_from_change_ids').notNullable().defaultTo('[]')

      table.json('validation_summary').nullable()

      table.timestamp('created_at').notNullable()

      table.unique(['session_id', 'version'])
      table.index(['session_id'])
      table.index(['preview_hash'])
    })
  }

  async down() {
    this.schema.dropTable('ai_draft_layer_previews')
  }
}
