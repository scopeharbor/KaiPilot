/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer Changes 表（task 2.2）。
 *
 * 保存 PDM 到 Preview 映射后的每条变更，供用户逐项审查/决策。
 * depends_on 表达依赖链（如 WBS 父节点必须先于子节点选择）。
 * 组织隔离通过 session_id → session → organization_id 间接实现。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_draft_layer_changes', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_draft_layer_sessions')
        .onDelete('CASCADE')

      table.string('target_entity_type', 30).notNullable()
      table.string('target_entity_id', 100).notNullable()
      table.string('target_field_path', 200).nullable()

      table.string('operation', 10).notNullable()
      table.check("operation IN ('create','update','delete')")

      table.json('value').notNullable()
      table.json('old_value').nullable()

      table.string('review_status', 12).notNullable().defaultTo('pending')
      table.check("review_status IN ('pending','accepted','rejected','modified','skipped')")

      table.json('user_modified_value').nullable()
      table.text('user_note').nullable()

      table.integer('sequence').notNullable()
      table.json('depends_on').notNullable().defaultTo('[]')
      table.decimal('confidence', 5, 4).notNullable().defaultTo(0.5)
      table.json('validation_summary').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['session_id'])
      table.index(['session_id', 'review_status'])
      table.index(['session_id', 'target_entity_type'])
    })
  }

  async down() {
    this.schema.dropTable('ai_draft_layer_changes')
  }
}
