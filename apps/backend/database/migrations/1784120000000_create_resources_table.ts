import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'resources'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table
        .bigInteger('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.string('name', 255).notNullable()
      table.string('email', 255).nullable()

      table.string('resource_type', 20).notNullable().defaultTo('human')
      table.check("resource_type IN ('human','material','equipment','budget')")

      table.string('role', 30).notNullable().defaultTo('member')
      table.check("role IN ('owner','project_manager','team_lead','member','viewer')")

      table.string('status', 20).notNullable().defaultTo('active')
      table.check("status IN ('active','inactive')")

      table.decimal('daily_capacity_hours', 4, 2).notNullable().defaultTo(8.0)
      table.json('skill_tags').nullable()
      table.json('work_days').notNullable().defaultTo('[1,2,3,4,5]')
      table.string('timezone', 64).notNullable().defaultTo('Asia/Shanghai')

      table.bigInteger('cost_per_unit_cents').nullable()

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['project_id', 'resource_type'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
