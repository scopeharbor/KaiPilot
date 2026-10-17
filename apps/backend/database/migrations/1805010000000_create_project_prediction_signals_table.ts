import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-ai-risk-progress-prediction — project_prediction_signals table.
 * Individual prediction signals scoped to a snapshot.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_prediction_signals', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('snapshot_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('project_prediction_snapshots')
        .onDelete('CASCADE')

      // Signal type
      table.string('signal_type', 30).notNullable()
      table.check(
        "signal_type IN ('schedule_risk','critical_path_drift','milestone_pressure'," +
          "'dependency_block','resource_bottleneck','risk_escalation','change_impact'," +
          "'data_staleness','data_quality')",
      )

      // Severity
      table.string('severity', 10).notNullable()
      table.check("severity IN ('critical','high','medium','low','info')")

      // Score (0-100)
      table.integer('score').notNullable().defaultTo(0)
      table.check('score >= 0 AND score <= 100')

      // Confidence
      table.string('confidence_band', 10).notNullable()
      table.check("confidence_band IN ('high','medium','low')")
      table.float('confidence_lower').nullable()
      table.float('confidence_upper').nullable()

      // Rule metadata
      table.string('rule_id', 40).notNullable()
      table.string('rule_version', 20).notNullable()
      table.text('description').notNullable()

      // Evidence (JSON array)
      table.json('evidence_refs').nullable()

      // Expiry
      table.timestamp('expires_at', { useTz: false }).nullable()

      // Timestamps
      table.timestamp('created_at', { useTz: false }).notNullable()

      // Indexes
      table.index(['snapshot_id'], 'idx_ppsig_snapshot')
      table.index(['signal_type'], 'idx_ppsig_type')
      table.index(['severity'], 'idx_ppsig_severity')
      table.index(['expires_at'], 'idx_ppsig_expires')
    })
  }

  async down() {
    this.schema.dropTable('project_prediction_signals')
  }
}
