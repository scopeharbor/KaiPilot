/**
 * v2-pdm-migration-compatibility —— 创建 pdm_migration_reports 表（Section 3.4）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pdm_migration_reports', (table) => {
      table.bigIncrements('id').primary()
      table
        .integer('migration_run_id')
        .unsigned()
        .notNullable()
        .references('pdm_migration_runs.id')
        .onDelete('CASCADE')
      table.string('report_type', 32).notNullable()
      table.string('severity', 16).notNullable()
      table.integer('blocking_count').unsigned().notNullable().defaultTo(0)
      table.integer('warning_count').unsigned().notNullable().defaultTo(0)
      table.integer('info_count').unsigned().notNullable().defaultTo(0)
      table.json('payload').nullable()
      table.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.index(['migration_run_id', 'report_type'], 'idx_pdm_reports_run_type')
    })
  }

  async down() {
    this.schema.dropTableIfExists('pdm_migration_reports')
  }
}
