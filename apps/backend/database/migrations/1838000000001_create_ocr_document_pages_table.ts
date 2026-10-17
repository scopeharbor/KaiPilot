import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_document_pages'

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
      table.integer('page_index').unsigned().notNullable()
      table.string('source_hash', 64).notNullable()
      table.string('status', 20).notNullable().defaultTo('pending')
      table.string('mime_type', 50).nullable()
      table.bigint('normalized_bytes').unsigned().nullable()
      table.json('warnings').nullable()
      table.integer('candidate_id').unsigned().nullable()
      table.text('candidate_text').nullable()
      table.string('candidate_hash', 64).nullable()
      table.string('provider', 100).nullable()
      table.string('model', 200).nullable()
      table.json('usage').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['job_id', 'page_index'], 'ocr_pages_job_page_idx')
      table.index(['status'], 'ocr_pages_status_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
