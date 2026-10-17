import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_structured_extraction_field_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('run_id')
        .notNullable()
        .references('id')
        .inTable('ocr_structured_extraction_runs')
      table.string('section_key', 128).notNullable()
      table.string('field_key', 128).notNullable()
      table.string('field_type', 32).notNullable() // text | date | number | enum | person_name | project_ref
      table.text('raw').notNullable()
      table.text('value_json').nullable() // OcrTypedFieldValue JSON
      table.string('confidence', 16).notNullable().defaultTo('unknown') // high | medium | low | unknown
      table.float('confidence_score').notNullable().defaultTo(0)
      table.integer('span_page_index').nullable()
      table.integer('span_char_start').nullable()
      table.integer('span_char_end').nullable()
      table.string('source_span_hash', 64).notNullable().index()
      table.string('candidate_hash', 64).notNullable().index()
      table.text('warnings_json').nullable() // OcrExtractionWarning[] JSON
      table.string('provenance', 32).notNullable().defaultTo('deterministic')
      table.string('status', 32).notNullable().defaultTo('generated').index() // generated | selected | rejected | superseded
      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.index(['run_id', 'section_key', 'field_key'])
      table.index(['run_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
