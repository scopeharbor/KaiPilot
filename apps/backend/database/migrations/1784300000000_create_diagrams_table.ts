import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'diagrams'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table.string('type', 30).notNullable()
      table.check("type IN ('wbs_tree','gantt','dependency_graph','critical_path')")

      table.string('title', 255).notNullable()

      // DiagramSpec JSON（TEXT 存储，V1 SQLite；PostgreSQL jsonb 留 DEBT-01）
      table.text('spec').notNullable()

      // 源数据指纹，用于陈旧检测
      table.string('source_hash', 128).nullable()

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 软删除 + 时间戳
      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['project_id', 'type'])
      table.index(['organization_id', 'project_id', 'deleted_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
