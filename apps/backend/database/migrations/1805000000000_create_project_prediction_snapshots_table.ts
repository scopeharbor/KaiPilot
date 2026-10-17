import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-ai-risk-progress-prediction — project_prediction_snapshots table.
 * Stores prediction snapshots per project/window/inputSignature/ruleVersion.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_prediction_snapshots', (table) => {
      table.bigIncrements('id')

      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()

      // Prediction window in days (7, 14, 30, 60, 90)
      table.integer('window').notNullable()
      table.check('"window" IN (7, 14, 30, 60, 90)')

      // Status
      table.string('status', 20).notNullable().defaultTo('pending')
      table.check("status IN ('pending', 'confirmed', 'dismissed', 'stale')")

      // Versioning
      table.string('rule_version', 20).notNullable()
      table.string('input_signature', 64).notNullable()
      table.string('output_hash', 64).notNullable()
      table.string('source_hash', 64).notNullable()

      // Warnings (JSON)
      table.json('warnings').nullable()

      // AI explanation metadata
      table.json('ai_explanation').nullable()

      // Confirmation
      table.string('confirmation_status', 20).notNullable().defaultTo('pending')
      table.bigInteger('confirmed_by').unsigned().nullable()
      table.timestamp('confirmed_at', { useTz: false }).nullable()
      table.text('confirmed_notes').nullable()
      table.bigInteger('dismissed_by').unsigned().nullable()
      table.timestamp('dismissed_at', { useTz: false }).nullable()
      table.text('dismiss_reason').nullable()

      // Staleness
      table.boolean('stale').notNullable().defaultTo(false)
      table.text('stale_reason').nullable()

      // Audit
      table.bigInteger('generated_by').unsigned().notNullable()
      table.timestamp('generated_at', { useTz: false }).notNullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // Indexes
      table.index(['organization_id'], 'idx_pps_org')
      table.index(['project_id'], 'idx_pps_project')
      table.index(['status'], 'idx_pps_status')
      table.index(['window'], 'idx_pps_window')
      table.index(['input_signature', 'rule_version'], 'idx_pps_input_rule')
      table.index(['generated_at'], 'idx_pps_generated_at')
    })
  }

  async down() {
    this.schema.dropTable('project_prediction_snapshots')
  }
}
