import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_progress_backflow_suggestions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .integer('key_result_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_key_results')
        .onDelete('CASCADE')
      table.decimal('proposed_value', 15, 4).notNullable()
      table.decimal('current_value', 15, 4).notNullable()
      table.decimal('delta', 15, 4).notNullable().defaultTo(0)
      table.text('contributions_json').notNullable() // JSON-serialized contribution array
      table.enum('confidence', ['low', 'medium', 'high']).notNullable().defaultTo('medium')
      table
        .enum('status', ['pending', 'needs_review', 'confirmed', 'rejected', 'stale'])
        .notNullable()
        .defaultTo('pending')
      table.text('warnings_json').nullable() // JSON-serialized warning array
      table.string('suggestion_hash', 64).notNullable()
      table.string('base_progress_version', 64).notNullable().defaultTo('1')
      table.string('freshness_json', 255).notNullable() // JSON-serialized freshness
      table.timestamp('calculated_at', { useTz: true }).notNullable()
      table
        .enum('reason_code', [
          'VALUE_INACCURATE',
          'SOURCE_STALE',
          'CONTRIBUTION_MISMATCH',
          'MANUAL_OVERRIDE_PREFERRED',
          'RESTRICTED_DATA_CONCERN',
          'OTHER',
        ])
        .nullable()
      table.string('reason_note', 500).nullable()
      table.integer('actor_id').unsigned().nullable()
      table.timestamp('actioned_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      // Indexes
      table.index(['organization_id'], 'okr_bf_suggestion_org_idx')
      table.index(['key_result_id'], 'okr_bf_suggestion_kr_idx')
      table.index(['status'], 'okr_bf_suggestion_status_idx')
      table.index(['suggestion_hash'], 'okr_bf_suggestion_hash_idx')
      table.index(['key_result_id', 'suggestion_hash'], 'okr_bf_suggestion_kr_hash_uidx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
