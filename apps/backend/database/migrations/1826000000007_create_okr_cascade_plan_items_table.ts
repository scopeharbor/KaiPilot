import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_cascade_plan_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('plan_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_cascade_plans')
        .onDelete('CASCADE')
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.text('candidate_objective').notNullable() // JSON: OkrAiDraftObjective
      table.string('status').notNullable().defaultTo('pending') // pending / confirmed / rejected / skipped
      table.boolean('coverage_gap').notNullable().defaultTo(false)
      table.text('conflict_warning').nullable()
      table.text('rejection_reason').nullable()
      table
        .integer('confirmed_objective_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      table.index(['plan_id'], 'cascade_items_plan_idx')
      table.index(['organization_id'], 'cascade_items_org_idx')
      table.index(['status'], 'cascade_items_status_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
