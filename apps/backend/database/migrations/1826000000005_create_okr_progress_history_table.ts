import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_progress_history'

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
      table.decimal('previous_value', 15, 4).notNullable()
      table.decimal('new_value', 15, 4).notNullable()
      table.string('source', 100).notNullable().defaultTo('manual')
      table.enum('confidence', ['low', 'medium', 'high']).notNullable().defaultTo('medium')
      table.text('note').nullable()
      table.text('evidence_refs').nullable()
      table.integer('recorded_by').unsigned().notNullable()
      table.timestamp('recorded_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()

      table.index(['key_result_id', 'recorded_at'], 'okr_progress_kr_time_idx')
      table.index(['organization_id'], 'okr_progress_org_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
