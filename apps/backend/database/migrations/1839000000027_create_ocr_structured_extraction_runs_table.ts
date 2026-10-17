import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_structured_extraction_runs'

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
      table
        .integer('profile_version_id')
        .notNullable()
        .references('id')
        .inTable('ocr_structured_extraction_profile_versions')
      table.string('profile_name', 255).notNullable()
      table.integer('profile_version').notNullable()
      table.string('status', 32).notNullable().defaultTo('pending').index() // pending | processing | completed | completed_with_warnings | failed | canceled
      table.string('provenance', 32).notNullable().defaultTo('deterministic') // deterministic | ai_assisted | ai_fallback
      table.string('source_hash', 64).notNullable().index()
      table.string('input_signature', 64).notNullable().index()
      table.string('idempotency_key', 255).notNullable()
      table.integer('total_field_candidates').notNullable().defaultTo(0)
      table.integer('total_table_candidates').notNullable().defaultTo(0)
      table.integer('warning_count').notNullable().defaultTo(0)
      table.integer('error_count').notNullable().defaultTo(0)
      table.text('warning_summary_json').nullable() // OcrExtractionWarningSummary JSON
      table.integer('created_by').notNullable().references('id').inTable('users')
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('completed_at').nullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['extraction_id', 'status'])
      table.index(['profile_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
