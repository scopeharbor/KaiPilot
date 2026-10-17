import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_structured_extraction_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('organization_id').notNullable().index()
      table.integer('project_id').notNullable().index()
      table.integer('extraction_id').notNullable() // ref: ocr_review_accepted_extractions
      table
        .integer('profile_id')
        .notNullable()
        .references('id')
        .inTable('ocr_structured_extraction_profiles')
      table.integer('profile_version').notNullable()
      table.string('source_hash', 64).notNullable().index()
      table.string('snapshot_hash', 64).notNullable().index()
      table.text('field_values_json').nullable() // Record<string, OcrTypedFieldValue>
      table.text('table_values_json').nullable() // Record<string, OcrTableRowCandidate[]>
      table.text('source_span_hashes_json').notNullable() // string[] JSON
      table.text('candidate_hashes_json').notNullable() // string[] JSON
      table.string('preview_hash', 64).notNullable()
      table.integer('reviewer_id').notNullable().references('id').inTable('users')
      table.text('review_note').nullable()
      table.string('status', 32).notNullable().defaultTo('current').index() // current | superseded
      table.integer('superseded_by_id').nullable()
      table.integer('field_count').notNullable().defaultTo(0)
      table.integer('table_count').notNullable().defaultTo(0)
      table.timestamp('confirmed_at').notNullable().defaultTo(this.now())
      table.timestamp('superseded_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['extraction_id', 'status'])
      table.index(['profile_id', 'source_hash'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
