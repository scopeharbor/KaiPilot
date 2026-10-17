/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer Apply Results 表（task 2.4）。
 *
 * 保存 apply 结果与幂等键。同一幂等键重复提交返回既有结果。
 * project_id 在 apply 成功后回填。
 * 组织隔离通过 session_id → session → organization_id 间接实现。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_draft_layer_apply_results', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_draft_layer_sessions')
        .onDelete('CASCADE')

      table.string('apply_plan_hash', 64).notNullable()
      table.string('selection_hash', 64).notNullable()

      table.string('status', 16).notNullable()
      table.check("status IN ('pending','dry_run_passed','applied','failed','rolled_back')")

      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')

      table.json('entity_counts').nullable()
      table.text('error_summary').nullable()

      table.string('idempotency_key', 100).notNullable().unique()

      table.timestamp('applied_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['session_id'])
      table.index(['session_id', 'status'])
      table.index(['idempotency_key'])
    })
  }

  async down() {
    this.schema.dropTable('ai_draft_layer_apply_results')
  }
}
