import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_document_extractions'

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
        .integer('source_attachment_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('attachments')
        .onDelete('SET NULL')
      table.text('accepted_text').notNullable()
      table.string('accepted_text_hash', 64).notNullable()
      table.json('page_refs').nullable()
      table.string('source_hash', 64).notNullable()
      table.integer('reviewer_id').unsigned().notNullable()
      table.text('review_note').nullable()
      table.string('status', 20).notNullable().defaultTo('active')
      table.integer('superseded_by_id').unsigned().nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['job_id'], 'ocr_extractions_job_idx')
      table.index(['source_attachment_id'], 'ocr_extractions_source_att_idx')
      table.index(['source_hash'], 'ocr_extractions_source_hash_idx')
      table.index(['status'], 'ocr_extractions_status_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
