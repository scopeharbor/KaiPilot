import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_pm_phase_integration_runs 表：TRIZ-PM 阶段整合分析运行
 * （v3-triz-pm-phase-integration §3.1）。
 *
 * 组织+项目双隔离；input_signature 保证幂等。
 * warning_summary/cost_summary 为 JSON 列。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_pm_phase_integration_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

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

      table.string('status', 20).notNullable().defaultTo('pending')
      table.check("status IN ('pending','running','completed','failed')")

      table.string('input_signature', 128).notNullable()
      table.string('output_hash', 128).nullable()
      table.string('idempotency_key', 128).notNullable()

      table.json('source_summary_json').notNullable().defaultTo('{}')
      table.json('warning_summary_json').notNullable().defaultTo('[]')
      table.json('cost_summary_json').nullable()

      table.integer('phase_count').notNullable().defaultTo(5)
      table.integer('blocked_phase_count').notNullable().defaultTo(0)
      table.integer('stale_phase_count').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('completed_at').nullable()

      // 索引（tppi = triz pm phase integration）
      table.index(['organization_id', 'project_id'], 'idx_tppi_runs_org_project')
      table.index(['project_id', 'status'], 'idx_tppi_runs_project_status')
      table.unique(['organization_id', 'project_id', 'idempotency_key'], 'uq_tppi_runs_idempotency')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
