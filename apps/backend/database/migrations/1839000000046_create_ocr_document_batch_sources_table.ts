import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_document_batch_sources'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()
      table
        .integer('batch_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ocr_document_batches')
        .onDelete('CASCADE')

      // Source ordering
      table.integer('source_index').unsigned().notNullable().defaultTo(0)

      // Source refs
      table
        .integer('source_attachment_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('attachments')
        .onDelete('SET NULL')
      table.string('source_file_name', 500).nullable()
      table.string('source_mime_type', 100).nullable()
      table.string('source_hash', 64).notNullable()

      // Linked OCR job (created or reused)
      table
        .integer('ocr_job_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ocr_document_jobs')
        .onDelete('SET NULL')

      // Per-source status
      table.string('status', 30).notNullable().defaultTo('queued')
      table.json('warning_codes').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_batch_src_org_proj_idx')
      table.index(['batch_id'], 'ocr_batch_src_batch_idx')
      table.index(['source_hash'], 'ocr_batch_src_hash_idx')
      table.unique(['batch_id', 'source_index'], 'ocr_batch_src_uniq_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
