/**
 * v2-traceability-source-attribution —— Source Attributions 表（task 2.1）。
 *
 * 组织级隔离：organization_id 必填 + 可索引。
 * 只存可审查摘要和 refs，不存完整 artifact payload。
 * SQLite 兼容 + PG 兼容（JSON 列、无 SQLite 专有语法）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('source_attributions', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('compiler_run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('compiler_runs')
        .onDelete('CASCADE')
      table
        .bigInteger('draft_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ai_draft_layer_sessions')
        .onDelete('SET NULL')

      table.string('stage_id', 100).notNullable()
      table.string('stage_attempt_id', 100).nullable()

      // 目标实体/字段（至少一个非空，或 unanchored=true）
      table.string('entity_id', 200).nullable()
      table.string('field_path', 200).nullable()

      // 来源 artifact refs（JSON 数组）
      table.json('source_refs').notNullable().defaultTo('[]')
      // 验证 refs（JSON 数组）
      table.json('validation_refs').notNullable().defaultTo('[]')

      // 生成方式
      table.string('generated_by_kind', 30).notNullable()
      table.check("generated_by_kind IN ('llm','deterministic_rule','user_edit','imported')")
      table.string('generated_by_provider', 100).nullable()
      table.string('generated_by_model', 100).nullable()
      table.json('token_summary').nullable()
      table.json('cost_summary').nullable()
      table.string('rule_id', 50).nullable()
      table.string('rule_name', 200).nullable()

      // 摘要与置信度
      table.text('summary').notNullable().defaultTo('')
      table.decimal('confidence', 3, 2).notNullable().defaultTo(0)

      // 假设列表（JSON 数组）
      table.json('assumptions').notNullable().defaultTo('[]')

      // 证据片段（JSON 数组，只存短摘要/hash/ref）
      table.json('evidence_snippets').notNullable().defaultTo('[]')

      // 内容 hash
      table.string('content_hash', 64).notNullable()

      // 人工确认状态
      table.string('human_review_status', 30).notNullable().defaultTo('pending')
      table.check(
        "human_review_status IN ('pending','reviewed_and_accepted','reviewed_and_modified','reviewed_and_rejected')",
      )
      table
        .bigInteger('human_reviewed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('human_reviewed_at').nullable()

      // Unanchored 标记
      table.boolean('unanchored').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('source_attributions')
  }
}
