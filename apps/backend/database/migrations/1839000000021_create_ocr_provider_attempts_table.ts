/**
 * v3-ocr-provider-observability-cost-controls §3.2 — OCR provider attempt 记录表。
 *
 * 每条记录代表一次 OCR provider 调用 attempt（包括被预算/限流跳过的）。
 * 低敏：不存 prompt/output body/API key/Authorization header/full extracted text。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class OcrProviderAttemptsMigration extends BaseSchema {
  public static readonly tableName = 'ocr_provider_attempts'

  async up() {
    this.schema.createTable(OcrProviderAttemptsMigration.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()
      table.integer('ocr_job_id').unsigned().notNullable()
      table.integer('page_id').unsigned().nullable()
      table.integer('attempt_number').unsigned().notNullable().defaultTo(1)

      table.string('provider', 128).notNullable()
      table.string('model', 128).notNullable()
      table.integer('connection_id').unsigned().nullable()
      table.integer('model_id').unsigned().nullable()
      table.string('capability_mode', 16).nullable()

      table.string('status', 24).notNullable().defaultTo('queued')
      table.integer('latency_ms').unsigned().nullable()

      // Usage fields (low-sensitive summary only)
      table.integer('input_tokens').unsigned().nullable()
      table.integer('output_tokens').unsigned().nullable()
      table.integer('total_tokens').unsigned().nullable()
      table.integer('cache_read_tokens').unsigned().nullable()
      table.integer('cache_write_tokens').unsigned().nullable()
      table.integer('audio_tokens').unsigned().nullable()
      table.integer('reasoning_tokens').unsigned().nullable()
      table.integer('context_tokens').unsigned().nullable()

      // Cost
      table.decimal('estimated_cost', 16, 10).nullable()
      table.string('currency', 8).nullable().defaultTo('USD')
      table.string('cost_status', 20).nullable()
      table.string('pricing_snapshot_id', 64).nullable()

      // Ref/hash fields
      table.string('input_hash', 32).nullable()
      table.string('output_ref', 64).nullable()
      table.string('output_hash', 32).nullable()

      // Decision refs
      table.string('budget_decision_ref', 64).nullable()
      table.string('rate_limit_decision_ref', 64).nullable()

      // Error
      table.string('error_category', 24).notNullable().defaultTo('none')
      table.json('warning_codes').nullable()

      // Idempotency
      table.string('idempotency_key', 64).notNullable()

      // Timestamps
      table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // Retention eligibility
      table.string('retention_lifecycle', 24).nullable()
      table.string('retention_sensitivity', 24).nullable()
      table.timestamp('retention_eligible_at', { useTz: true }).nullable()
      table.timestamp('purged_at', { useTz: true }).nullable()
      table.integer('tombstone_id').unsigned().nullable()
      table.string('retention_policy_hash', 64).nullable()

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_attempts_org_proj_idx')
      table.index(['organization_id', 'project_id', 'ocr_job_id'], 'ocr_attempts_job_idx')
      table.index(
        ['organization_id', 'project_id', 'ocr_job_id', 'page_id'],
        'ocr_attempts_page_idx',
      )
      table.index(['status'], 'ocr_attempts_status_idx')
      table.index(['occurred_at'], 'ocr_attempts_occurred_at_idx')
      table.index(['error_category'], 'ocr_attempts_error_cat_idx')
      table.unique(['idempotency_key'], 'ocr_attempts_ik_unique')
    })
  }

  async down() {
    this.schema.dropTableIfExists(OcrProviderAttemptsMigration.tableName)
  }
}
