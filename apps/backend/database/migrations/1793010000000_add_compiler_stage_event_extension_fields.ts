import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('compiler_stage_events', (table) => {
      table.string('entity_id', 80).nullable()
      table.integer('attempt_number').unsigned().nullable()
      table.string('model_mode', 30).nullable()
      table.integer('token_budget').unsigned().nullable()
      table.text('validation_summary').nullable()

      table.index(['compiler_run_id', 'entity_id'], 'idx_compiler_stage_events_run_entity')
    })
  }

  async down() {
    this.schema.alterTable('compiler_stage_events', (table) => {
      table.dropIndex(['compiler_run_id', 'entity_id'], 'idx_compiler_stage_events_run_entity')
      table.dropColumn('validation_summary')
      table.dropColumn('token_budget')
      table.dropColumn('model_mode')
      table.dropColumn('attempt_number')
      table.dropColumn('entity_id')
    })
  }
}
