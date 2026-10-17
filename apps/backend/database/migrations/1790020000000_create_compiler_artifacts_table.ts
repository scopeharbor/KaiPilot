/**
 * v2-project-compiler-foundation —— CompilerArtifact 表（tasks 3.3）。
 *
 * 组织级隔离：organization_id 必填。
 * 存储 PDM、Manifest、Ledger、Stage 输出、Checkpoint 的 JSON 快照。
 * 同一个 run 的 artifact 可按 kind/version 查询最新快照。
 * Checkpoint 语义：每 Stage 写进度 + 每 Phase 写全量 PDM 快照。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('compiler_artifacts', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('compiler_run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('compiler_runs')
        .onDelete('CASCADE')
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('kind', 30).notNullable()
      table.check("kind IN ('pdm','manifest','ledger','stage_output','checkpoint')")

      table.string('stage_id', 60).nullable()
      table.integer('version').unsigned().notNullable().defaultTo(1)

      table.json('payload').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['compiler_run_id'])
      table.index(['organization_id'])
      table.index(['compiler_run_id', 'kind'])
      table.index(['compiler_run_id', 'kind', 'version'])
    })
  }

  async down() {
    this.schema.dropTable('compiler_artifacts')
  }
}
