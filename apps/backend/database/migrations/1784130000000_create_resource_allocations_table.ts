import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'resource_allocations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('resource_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')

      table
        .bigInteger('task_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')

      table.string('allocation_type', 20).notNullable().defaultTo('assigned')
      table.check("allocation_type IN ('assigned','allocated','reserved')")

      table.decimal('allocation_percent', 5, 2).notNullable().defaultTo(100.0)

      table.date('start_date').nullable()
      table.date('end_date').nullable()

      table.decimal('planned_units', 10, 2).nullable()
      table.decimal('actual_units', 10, 2).nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['resource_id', 'start_date', 'end_date'])
      table.index(['task_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
