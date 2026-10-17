import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_cascade_plans'

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
        .integer('source_objective_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('CASCADE')
      table
        .integer('cycle_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_cycles')
        .onDelete('CASCADE')
      table.string('title').notNullable()
      table.text('description').nullable()
      table.string('status').notNullable().defaultTo('draft') // draft / confirmed / rejected / archived
      table.string('coverage').notNullable().defaultTo('unknown') // full / partial / gap / unknown
      table.text('warnings').nullable() // JSON stringified OkrWarning[]
      table.text('assumptions').nullable() // JSON stringified string[]
      table.text('source_refs').nullable() // JSON stringified string[]
      table.string('metric_version').notNullable().defaultTo('1.0.0')
      table.string('revision_hash').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      table.index(['organization_id', 'deleted_at'], 'cascade_plans_org_idx')
      table.index(['source_objective_id'], 'cascade_plans_source_idx')
      table.index(['cycle_id'], 'cascade_plans_cycle_idx')
      table.index(['status'], 'cascade_plans_status_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
