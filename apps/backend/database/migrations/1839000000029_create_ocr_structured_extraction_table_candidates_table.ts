import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_structured_extraction_table_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('run_id')
        .notNullable()
        .references('id')
        .inTable('ocr_structured_extraction_runs')
      table.string('table_key', 128).notNullable()
      table.integer('column_count').notNullable().defaultTo(0)
      table.text('rows_json').notNullable() // OcrTableRowCandidate[] JSON
      table.integer('max_rows').notNullable().defaultTo(0)
      table.string('confidence', 16).notNullable().defaultTo('unknown')
      table.float('confidence_score').notNullable().defaultTo(0)
      table.text('warnings_json').nullable() // OcrExtractionWarning[] JSON
      table.string('provenance', 32).notNullable().defaultTo('deterministic')
      table.string('status', 32).notNullable().defaultTo('generated').index()
      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.index(['run_id', 'table_key'])
      table.index(['run_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
