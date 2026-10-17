/**
 * v2-project-compiler-foundation —— CompilerStageEvent 表（tasks 3.2）。
 *
 * 组织级隔离：organization_id 必填 + 与 compiler_run_id 联合索引。
 * 记录每个 Stage 的起止时间、状态、LLM 调用计数与成本。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('compiler_stage_events', (table) => {
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

      table.string('stage_id', 60).notNullable()
      table.string('phase', 30).notNullable()
      table.string('status', 20).notNullable().defaultTo('pending')
      table.check(
        "status IN ('pending','running','completed','failed','skipped','needs_human_review')",
      )

      table.timestamp('started_at').nullable()
      table.timestamp('ended_at').nullable()
      table.integer('duration_ms').unsigned().nullable()

      table.integer('llm_calls').unsigned().notNullable().defaultTo(0)
      table.decimal('llm_cost', 12, 6).notNullable().defaultTo(0)

      table.json('error').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['compiler_run_id'])
      table.index(['organization_id'])
      table.index(['compiler_run_id', 'stage_id'])
    })
  }

  async down() {
    this.schema.dropTable('compiler_stage_events')
  }
}
