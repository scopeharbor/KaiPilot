import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_progress_backflow_source_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .integer('suggestion_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_progress_backflow_suggestions')
        .onDelete('CASCADE')
      table.enum('source_kind', ['project', 'milestone', 'task']).notNullable()
      table.integer('source_id').unsigned().notNullable()
      table.integer('source_organization_id').unsigned().notNullable()
      table.decimal('weight', 5, 2).notNullable().defaultTo(100)
      table.decimal('progress', 5, 2).notNullable().defaultTo(0)
      table.timestamp('source_last_updated_at', { useTz: true }).notNullable()
      table.boolean('restricted').notNullable().defaultTo(false)
      table.timestamp('created_at', { useTz: true }).notNullable()

      // Indexes
      table.index(['organization_id'], 'okr_bf_snapshot_org_idx')
      table.index(['suggestion_id'], 'okr_bf_snapshot_sg_idx')
      table.index(['source_kind', 'source_id'], 'okr_bf_snapshot_src_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
