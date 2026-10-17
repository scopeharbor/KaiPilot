import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_pm_phase_actions 表：TRIZ-PM 阶段审查动作/Handoff 元数据
 * （v3-triz-pm-phase-integration §3.3）。
 *
 * 每条记录是一次人工审查动作或 handoff preview 的轻量记录。
 * source_hashes_json/confirmation_metadata_json 为 JSON 列。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_pm_phase_actions'

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
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('phase_id', 30).notNullable()
      table.string('recommendation_id', 256).notNullable()
      table.string('action_kind', 40).notNullable()
      table.string('handoff_target', 30).nullable()
      table.string('idempotency_key', 256).notNullable()
      table.string('status', 30).notNullable().defaultTo('open')
      table.check("status IN ('open','reviewed','handoff_initiated','handoff_blocked')")

      table.json('source_hashes_json').notNullable().defaultTo('{}')
      table.json('confirmation_metadata_json').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（tppa = triz pm phase actions）
      table.index(['run_id', 'phase_id'], 'idx_tppa_run_phase')
      table.index(['organization_id', 'project_id'], 'idx_tppa_org_project')
      table.unique(['organization_id', 'project_id', 'idempotency_key'], 'uq_tppa_idempotency')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
