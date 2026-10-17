// 这里必须是具名导入 '@adonisjs/lucid/schema'：'@adonisjs/lucid/schema/types/schema'
// 不在该包的 exports 里，模块解析在启动阶段就失败，整个 functional 套件起不来。
// 全仓另外 228 个迁移都是这个写法。
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'organization_settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.string('key', 255).notNullable()
      table.text('value').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 唯一索引：同一组织下同一 key 只能有一条记录
      table.unique(['organization_id', 'key'])

      // 外键
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
