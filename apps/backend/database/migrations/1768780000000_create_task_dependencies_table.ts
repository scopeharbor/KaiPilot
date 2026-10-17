import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * task_dependencies 表：任务间四种依赖关系（sec7.1.3）。
 * - predecessor_id / successor_id → tasks ON DELETE CASCADE
 * - type：fs（完成到开始，默认）/ ss / ff / sf
 * - lag_days 可为负数（提前量 / 正数表示滞后量）
 * - 联合唯一 (predecessor_id, successor_id) 防重复依赖
 * 循环检测在应用层 DFS 实现，本表不负责。关联性质，不软删除（design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'task_dependencies'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('predecessor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')
      table
        .bigInteger('successor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')

      table.string('type', 2).notNullable().defaultTo('fs')
      table.check("type IN ('fs','ss','ff','sf')")

      table.integer('lag_days').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 联合唯一：同一对前置-后续任务不能重复
      table.unique(['predecessor_id', 'successor_id'])
      // 反向查询支撑（predecessor_id 已为联合唯一前导列）
      table.index(['successor_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
