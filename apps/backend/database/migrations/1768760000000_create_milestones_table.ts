import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * milestones 表：项目里程碑节点（sec7.1.3）。
 * - project_id → projects ON DELETE CASCADE
 * - status 五阶段：not_started/planned/at_risk/achieved/missed
 * 关联性质，不软删除（design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'milestones'

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

      table.string('name', 255).notNullable()
      table.text('description').nullable()

      table.string('status', 20).notNullable().defaultTo('not_started')
      table.check("status IN ('not_started','planned','at_risk','achieved','missed')")

      table.date('planned_date').nullable()
      // 由关键路径自动计算出的里程碑
      table.boolean('auto_calculated').notNullable().defaultTo(false)
      table.integer('display_order').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：里程碑列表、状态筛选、日期排序（sec7.5）
      table.index(['project_id'])
      table.index(['status'])
      table.index(['planned_date'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
