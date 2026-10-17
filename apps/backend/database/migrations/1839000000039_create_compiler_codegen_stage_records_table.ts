import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'compiler_codegen_stage_records'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('run_id')
        .notNullable()
        .references('id')
        .inTable('compiler_codegen_candidate_runs')
        .onDelete('CASCADE')
      // 冗余组织字段：让 memory port 的 list 无需 join 即可做租户过滤
      table.integer('organization_id').notNullable()
      table.string('runtime_session_id', 128).notNullable()
      table.string('stage_id', 64).notNullable()
      table.integer('stage_order').notNullable()
      table.string('status', 24).notNullable().defaultTo('completed') // completed
      table.string('contract_version', 32).notNullable()
      table.string('context_scope', 40).notNullable()
      table.string('reason_code', 64).notNullable()
      table.text('artifact_refs_json').notNullable()
      table.text('observation_refs_json').notNullable()
      table.text('tool_call_ids_json').notNullable()
      table.text('visible_tool_ids_json').notNullable()
      table.text('summary').notNullable()
      table.timestamp('completed_at').notNullable()

      table.unique(['run_id', 'stage_id'])
      table.index(['organization_id', 'runtime_session_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
