import { BaseSchema } from '@adonisjs/lucid/schema'

/** V1 单一甘特基线：每个项目最多一行，快照为最小日期 JSON。 */
export default class extends BaseSchema {
  protected tableName = 'gantt_baselines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table.json('snapshot').notNullable()
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
