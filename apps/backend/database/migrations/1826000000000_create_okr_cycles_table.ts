import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_cycles'

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
      table.string('title', 255).notNullable()
      table.text('description').nullable()
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table
        .enum('status', ['draft', 'active', 'paused', 'completed', 'archived'])
        .notNullable()
        .defaultTo('draft')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      // 组织隔离 + 周期日期范围索引
      table.index(['organization_id', 'status'], 'okr_cycles_org_status_idx')
      table.index(['organization_id', 'start_date', 'end_date'], 'okr_cycles_org_dates_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
