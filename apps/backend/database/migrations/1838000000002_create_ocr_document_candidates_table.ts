import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_document_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table
        .integer('job_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ocr_document_jobs')
        .onDelete('CASCADE')
      table
        .integer('page_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ocr_document_pages')
        .onDelete('CASCADE')
      table.string('status', 20).notNullable().defaultTo('pending')
      table.text('extracted_text').nullable()
      table.string('text_hash', 64).nullable()
      table.float('confidence_score').nullable()
      table.string('source_hash', 64).notNullable()
      table.string('provider', 100).nullable()
      table.string('model', 200).nullable()
      table.json('warnings').nullable()
      table.json('usage').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['job_id'], 'ocr_candidates_job_idx')
      table.index(['page_id'], 'ocr_candidates_page_idx')
      table.index(['status'], 'ocr_candidates_status_idx')
      table.index(['source_hash'], 'ocr_candidates_source_hash_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
