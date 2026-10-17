import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_document_batches'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()
      table.integer('created_by').unsigned().notNullable()

      // Source snapshot
      table.integer('source_count').unsigned().notNullable().defaultTo(0)
      table.json('source_ids_json').nullable() // [attachmentId, ...]
      table.json('source_hashes_json').nullable() // [{attachmentId, hash}, ...]

      // Model / options
      table.integer('connection_id').unsigned().nullable()
      table.integer('model_id').unsigned().nullable()
      table.string('provider', 100).nullable()
      table.string('model', 200).nullable()
      table.text('prompt_hint').nullable()
      table.integer('page_limit').unsigned().nullable()

      // Status & progress
      table.string('status', 20).notNullable().defaultTo('queued') // drafting|queued|processing|partial|completed|failed|cancelled|paused
      table.string('aggregate_status', 20).nullable() // none|queued|processing|succeeded|partial|failed|cancelled|budget_blocked|rate_limited|stale_blocked
      table.integer('completed_count').unsigned().notNullable().defaultTo(0)
      table.integer('failed_count').unsigned().notNullable().defaultTo(0)
      table.integer('cancelled_count').unsigned().notNullable().defaultTo(0)
      table.integer('queued_count').unsigned().notNullable().defaultTo(0)
      table.integer('processing_count').unsigned().notNullable().defaultTo(0)

      // Idempotency
      table.string('idempotency_key_hash', 64).nullable()
      table.string('input_signature', 64).nullable()

      // Warnings / cost
      table.json('warning_codes').nullable()
      table.json('warnings').nullable()
      table.json('cost_summary').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_batches_org_proj_idx')
      table.index(['idempotency_key_hash'], 'ocr_batches_idemp_key_idx')
      table.index(['status'], 'ocr_batches_status_idx')
      table.index(['created_at'], 'ocr_batches_created_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
