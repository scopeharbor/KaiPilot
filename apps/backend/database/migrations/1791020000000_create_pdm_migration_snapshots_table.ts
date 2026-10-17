/**
 * v2-pdm-migration-compatibility —— 创建 pdm_migration_snapshots 表（Section 3.3）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pdm_migration_snapshots', (table) => {
      table.bigIncrements('id').primary()
      table
        .integer('migration_run_id')
        .unsigned()
        .notNullable()
        .references('pdm_migration_runs.id')
        .onDelete('CASCADE')
      table.string('snapshot_kind', 32).notNullable()
      table.string('entity_ref', 128).nullable()
      table.json('payload').nullable()
      table.string('payload_hash', 64).notNullable()
      table.boolean('is_rollback_ready').notNullable().defaultTo(true)
      table
        .integer('created_by_user_id')
        .unsigned()
        .notNullable()
        .references('users.id')
        .onDelete('CASCADE')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.index(['migration_run_id', 'snapshot_kind'], 'idx_pdm_snapshots_run_kind')
    })
  }

  async down() {
    this.schema.dropTableIfExists('pdm_migration_snapshots')
  }
}
