import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_objectives'

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
        .integer('cycle_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('okr_cycles')
        .onDelete('SET NULL')
      table
        .integer('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table
        .integer('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .enum('scope', ['organization', 'team', 'project', 'individual'])
        .notNullable()
        .defaultTo('organization')
      table.string('title', 500).notNullable()
      table.text('description').nullable()
      table
        .enum('status', ['draft', 'active', 'paused', 'completed', 'archived'])
        .notNullable()
        .defaultTo('draft')
      table.decimal('weight', 5, 2).notNullable().defaultTo(1)
      table.decimal('progress', 5, 2).notNullable().defaultTo(0)
      table.enum('confidence', ['low', 'medium', 'high']).notNullable().defaultTo('medium')
      table.date('start_date').nullable()
      table.date('end_date').nullable()
      table.string('metric_version', 20).notNullable().defaultTo('1.0.0')
      table.timestamp('calculated_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      table.index(['organization_id', 'status'], 'okr_objectives_org_status_idx')
      table.index(['organization_id', 'cycle_id'], 'okr_objectives_org_cycle_idx')
      table.index(['organization_id', 'scope'], 'okr_objectives_org_scope_idx')
      table.index(['cycle_id', 'status'], 'okr_objectives_cycle_status_idx')
      table.index(['project_id'], 'okr_objectives_project_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
