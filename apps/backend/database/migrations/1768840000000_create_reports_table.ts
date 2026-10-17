import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * reports 表：项目报表定义与生成结果（sec7.2.2）。
 * - project_id → projects ON DELETE CASCADE
 * - report_type 七类：status/progress/risk/resource/cost/milestone/custom
 * 软删除（sec7.5 / design D6）。
 */
export default class extends BaseSchema {
  protected tableName = 'reports'

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

      table.string('title', 255).notNullable()

      table.string('report_type', 20).notNullable().defaultTo('status')
      table.check(
        "report_type IN ('status','progress','risk','resource','cost','milestone','custom')",
      )

      // 报表配置（筛选 / 分组 / 排序）
      table.json('config').nullable()
      // 生成时数据快照（历史对比）
      table.json('data_snapshot').nullable()
      // 格式配置（主题色 / 列宽 / 可见列）
      table.json('format_config').nullable()

      table.timestamp('generated_at').nullable()
      table
        .bigInteger('generated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('file_path', 500).nullable()
      table.string('file_format', 10).nullable()

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：报表类型筛选、生成时间排序（sec7.5）
      table.index(['project_id', 'report_type'])
      table.index(['generated_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
