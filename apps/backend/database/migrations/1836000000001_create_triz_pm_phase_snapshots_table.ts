import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_pm_phase_snapshots 表：TRIZ-PM 阶段整合快照
 * （v3-triz-pm-phase-integration §3.2）。
 *
 * 每条记录是一个 PM 阶段的低敏审查快照。
 * source_refs_json/source_hashes_json/gaps_json/recommendations_json/review_metadata_json 为 JSON 列。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_pm_phase_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_pm_phase_integration_runs')
        .onDelete('CASCADE')
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table.string('snapshot_id', 256).notNullable().unique()
      table.string('phase_id', 30).notNullable()
      table.check("phase_id IN ('initiation','planning','execution','monitoring','change_control')")
      table.string('phase_label', 50).notNullable()

      table.json('source_refs_json').notNullable().defaultTo('[]')
      table.json('source_hashes_json').notNullable().defaultTo('{}')
      table.json('gaps_json').notNullable().defaultTo('[]')
      table.json('recommendations_json').notNullable().defaultTo('[]')
      table.json('warnings_json').notNullable().defaultTo('[]')

      table.string('readiness', 40).notNullable().defaultTo('insufficient_evidence')
      table.check(
        "readiness IN ('ready','needs_review','blocked_stale','insufficient_evidence','requires_human_confirmation')",
      )
      table.boolean('stale').notNullable().defaultTo(false)
      table.string('methodology_hint', 200).nullable()

      table.json('review_metadata_json').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（tpps = triz pm phase snapshots）
      table.index(['run_id', 'phase_id'], 'idx_tpps_run_phase')
      table.index(['organization_id', 'project_id'], 'idx_tpps_org_project')
      table.index(['snapshot_id'], 'idx_tpps_snapshot_id')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
