/**
 * v2-pdm-migration-compatibility —— 创建 pdm_entity_mappings 表（Section 3.2）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pdm_entity_mappings', (table) => {
      table.bigIncrements('id').primary()
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('organizations.id')
        .onDelete('CASCADE')
      table.string('source_kind', 32).notNullable()
      table.string('source_table', 64).notNullable()
      table.bigInteger('source_id').unsigned().notNullable()
      table.string('source_hash', 64).notNullable()
      table.string('pdm_entity_type', 32).nullable()
      table.string('pdm_entity_id', 64).nullable()
      table
        .integer('migration_run_id')
        .unsigned()
        .notNullable()
        .references('pdm_migration_runs.id')
        .onDelete('CASCADE')
      table.string('status', 24).notNullable().defaultTo('active')
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.unique(
        ['organization_id', 'source_kind', 'source_table', 'source_id'],
        'idx_pdm_entity_mappings_source_unique',
      )
      table.index(['migration_run_id'], 'idx_pdm_entity_mappings_run')
      table.index(['pdm_entity_id'], 'idx_pdm_entity_mappings_pdm_id')
      table.index(['organization_id', 'pdm_entity_type'], 'idx_pdm_entity_mappings_org_type')
      table.index(['source_hash'], 'idx_pdm_entity_mappings_hash')
    })
  }

  async down() {
    this.schema.dropTableIfExists('pdm_entity_mappings')
  }
}
