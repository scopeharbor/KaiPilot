import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * file_tags 表：项目内标签字典（D1）。
 * 每个标签属于一个项目，包含名称和颜色。
 */
export default class extends BaseSchema {
  protected tableName = 'file_tags'

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
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('name', 50).notNullable()
      table.string('color', 7).nullable().defaultTo('#3B82F6') // 默认蓝色

      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 项目内标签名唯一
      table.unique(['project_id', 'name'], 'idx_file_tags_unique_name')
      table.index(['project_id'])
      table.index(['organization_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
