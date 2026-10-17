/**
 * v2-pdm-migration-compatibility —— 创建 pdm_migration_runs 表（Section 3.1）。
 *
 * 记录每次迁移的运行态、范围、状态、操作者与计数。
 * 组织隔离：所有查询通过 organization_id 过滤。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pdm_migration_runs', (table) => {
      table.increments('id').primary()
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('organizations.id')
        .onDelete('CASCADE')
      table
        .integer('requested_by_user_id')
        .unsigned()
        .notNullable()
        .references('users.id')
        .onDelete('CASCADE')
      table.string('status', 32).notNullable().defaultTo('planned')
      table.string('current_phase', 64).nullable()
      table.text('scope_json').nullable()
      table.json('counts_json').nullable()
      table.integer('latest_report_id').unsigned().nullable()
      table.text('error_summary').nullable()
      table.text('rollback_info').nullable()
      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('completed_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.index(['organization_id', 'status'], 'idx_pdm_migration_runs_org_status')
      table.index(['requested_by_user_id'], 'idx_pdm_migration_runs_user')
    })
  }

  async down() {
    this.schema.dropTableIfExists('pdm_migration_runs')
  }
}
