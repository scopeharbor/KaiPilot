import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_queue_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()

      // Batch / job / page refs
      table
        .integer('batch_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ocr_document_batches')
        .onDelete('CASCADE')
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
        .nullable()
        .references('id')
        .inTable('ocr_document_pages')
        .onDelete('SET NULL')

      // Dispatch metadata
      table.string('work_kind', 10).notNullable().defaultTo('job') // job|page
      table.integer('priority').notNullable().defaultTo(0)
      table.string('status', 30).notNullable().defaultTo('queued')

      // Attempt tracking
      table.integer('attempt_count').unsigned().notNullable().defaultTo(0)
      table.integer('max_attempts').unsigned().notNullable().defaultTo(3)
      table.timestamp('next_attempt_at').nullable()
      table.timestamp('retry_after').nullable()

      // Locking (SQLite-compatible guard)
      table.string('lock_owner', 100).nullable()
      table.timestamp('locked_at').nullable()

      // Source & model
      table.string('source_hash', 64).notNullable()
      table.string('provider', 100).nullable()
      table.string('model', 200).nullable()
      table.integer('connection_id').unsigned().nullable()
      table.integer('model_id').unsigned().nullable()

      // Failure / warnings
      table.string('failure_category', 30).nullable().defaultTo('none')
      table.json('warning_codes').nullable()
      table.json('warnings').nullable()

      // Idempotency (duplicate dispatch prevention)
      table.string('idempotency_key_hash', 64).nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_queue_org_proj_idx')
      table.index(['batch_id'], 'ocr_queue_batch_idx')
      table.index(['job_id'], 'ocr_queue_job_idx')
      table.index(['page_id'], 'ocr_queue_page_idx')
      table.index(['status'], 'ocr_queue_status_idx')
      table.index(['next_attempt_at'], 'ocr_queue_next_att_idx')
      table.index(['locked_at'], 'ocr_queue_locked_idx')
      table.unique(['idempotency_key_hash'], 'ocr_queue_idemp_key_uniq')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
