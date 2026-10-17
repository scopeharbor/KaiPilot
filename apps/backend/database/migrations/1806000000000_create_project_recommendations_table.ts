import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-ai-smart-recommendations — project_recommendations table.
 * Stores project-level smart recommendation records with evidence, AI metadata,
 * and review lifecycle.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_recommendations', (table) => {
      table.bigIncrements('id')

      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()

      // Source
      table.string('source_type', 30).notNullable()
      table.string('source_id', 100).notNullable()
      table.check(
        "source_type IN ('resource', 'risk', 'change_impact', 'dashboard', 'report', 'health_diagnosis', 'prediction', 'weekly_report', 'monthly_report', 'manual')",
      )

      // Target reference (JSON)
      table.json('target_ref').notNullable()

      // Content
      table.string('title', 255).notNullable()
      table.text('summary').notNullable()
      table.text('recommended_action').nullable()
      table.string('action_type', 20).notNullable().defaultTo('navigate')
      table.check("action_type IN ('navigate', 'create_draft', 'open_preview', 'draft_layer')")

      // Scoring
      table.string('severity', 10).notNullable().defaultTo('medium')
      table.check("severity IN ('critical', 'high', 'medium', 'low', 'info')")
      table.integer('priority').notNullable().defaultTo(0)
      table.string('confidence', 10).notNullable().defaultTo('medium')
      table.check("confidence IN ('high', 'medium', 'low')")

      // Deduplication
      table.string('dedupe_key', 128).notNullable()
      table.string('input_signature', 64).notNullable()
      table.string('evidence_hash', 64).notNullable()
      table.json('evidence_refs').nullable()

      // Status
      table.string('status', 20).notNullable().defaultTo('new')
      table.check(
        "status IN ('new', 'reviewing', 'accepted', 'dismissed', 'snoozed', 'converted', 'expired')",
      )

      // Warnings
      table.json('warnings').nullable()

      // AI metadata
      table.json('ai_metadata').nullable()

      // Expiration
      table.timestamp('expires_at', { useTz: false }).nullable()

      // Staleness
      table.boolean('stale').notNullable().defaultTo(false)
      table.text('stale_reason').nullable()

      // Audit
      table.bigInteger('created_by').unsigned().notNullable()
      table.bigInteger('handled_by').unsigned().nullable()
      table.timestamp('handled_at', { useTz: false }).nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // Indexes
      table.index(['organization_id'], 'idx_prec_org')
      table.index(['project_id'], 'idx_prec_project')
      table.index(['status'], 'idx_prec_status')
      table.index(['source_type'], 'idx_prec_source')
      table.index(['severity'], 'idx_prec_severity')
      table.index(['priority'], 'idx_prec_priority')
      table.index(['dedupe_key'], 'idx_prec_dedupe')
      table.index(['input_signature'], 'idx_prec_input_sig')
      table.index(['created_at'], 'idx_prec_created_at')
    })
  }

  async down() {
    this.schema.dropTable('project_recommendations')
  }
}
