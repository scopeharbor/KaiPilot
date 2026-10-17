/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer Sessions 表（task 2.1）。
 *
 * 组织级隔离：organization_id 必填 + 可索引。
 * 红线：本表只存草案运行态元数据，不存 V1 正式业务数据。
 * Compiler Run PDM handoff 后在此保存摘要与 hash，PDM 正文存在 Compiler Artifact。
 * SQLite 兼容 + PG 兼容（JSON 列、无 SQLite 专有语法）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_draft_layer_sessions', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('created_by_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('source_type', 20).notNullable()
      table.check("source_type IN ('v2_compiler_pdm')")

      table
        .bigInteger('compiler_run_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('compiler_runs')
        .onDelete('SET NULL')
      table.string('pdm_artifact_id', 200).nullable()
      table.string('pdm_hash', 64).nullable()

      table.string('status', 20).notNullable().defaultTo('active')
      table.check(
        "status IN ('active','previewing','reviewing','applying','applied','discarded','expired')",
      )
      table.integer('version').notNullable().defaultTo(1)

      table.timestamp('expires_at').nullable()

      table.json('summary').nullable()
      table.json('metadata').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['compiler_run_id'])
      table.index(['created_by_user_id'])
    })
  }

  async down() {
    this.schema.dropTable('ai_draft_layer_sessions')
  }
}
