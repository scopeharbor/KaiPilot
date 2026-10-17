import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-ai-priority-recommendations — pmo_ai_priority_recommendations table.
 *
 * Stores organization-level PMO recommendation records with priority context,
 * source signals, AI metadata, review lifecycle, and low-sensitive audit fields.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_ai_priority_recommendations', (table) => {
      table.bigIncrements('id')

      // Organization + Project
      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()

      // Source
      table.string('source_type', 50).notNullable()
      table.string('source_id', 120).notNullable()

      // Content
      table.string('title', 300).notNullable()
      table.text('summary').notNullable()
      table.text('suggested_action').nullable()
      table.string('action_type', 20).notNullable().defaultTo('navigate')

      // Severity
      table.string('severity', 10).notNullable().defaultTo('medium')

      // Priority context (JSON)
      table.json('priority_context').notNullable()

      // Source signals (JSON array)
      table.json('source_signals').notNullable()

      // Evidence refs (JSON array)
      table.json('evidence_refs').nullable()

      // Status (same lifecycle as project recommendations)
      table.string('status', 20).notNullable().defaultTo('new')

      // Warnings (JSON array)
      table.json('warnings').nullable()

      // AI metadata (JSON)
      table.json('ai_metadata').nullable()

      // AI status
      table.string('ai_status', 20).notNullable().defaultTo('none')

      // Deduplication
      table.string('dedupe_key', 160).notNullable()
      table.string('input_signature', 80).notNullable()

      // Candidate version
      table
        .string('candidate_version', 60)
        .notNullable()
        .defaultTo('pmo-ai-priority-recommendations.v1')

      // Expiration & Staleness
      table.timestamp('expires_at', { useTz: false }).nullable()
      table.boolean('stale').notNullable().defaultTo(false)
      table.text('stale_reason').nullable()

      // Review metadata
      table.timestamp('snoozed_until', { useTz: false }).nullable()
      table.text('review_reason').nullable()

      // Audit
      table.bigInteger('created_by').unsigned().notNullable()
      table.bigInteger('handled_by').unsigned().nullable()
      table.timestamp('handled_at', { useTz: false }).nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // Indexes
      table.index(['organization_id'], 'idx_pmo_rec_org')
      table.index(['project_id'], 'idx_pmo_rec_project')
      table.index(['status'], 'idx_pmo_rec_status')
      table.index(['source_type'], 'idx_pmo_rec_source')
      table.index(['severity'], 'idx_pmo_rec_severity')
      table.index(['ai_status'], 'idx_pmo_rec_ai_status')
      table.index(['dedupe_key'], 'idx_pmo_rec_dedupe')
      table.index(['input_signature'], 'idx_pmo_rec_input_sig')
      table.index(['created_at'], 'idx_pmo_rec_created_at')
      table.index(['stale'], 'idx_pmo_rec_stale')
    })
  }

  async down() {
    this.schema.dropTable('pmo_ai_priority_recommendations')
  }
}
