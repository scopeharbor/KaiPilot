import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * tasks 表补列：progress_percent（sec08.3.1 状态端点入参，0-100 整数）。
 *
 * create_tasks_table 漏建此列；本迁移补齐以对齐详设（design「待解决问题」
 * 倾向补列）。默认 0、非空。CPM/关键路径重算仍留 T021。
 */
export default class extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('progress_percent').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('progress_percent')
    })
  }
}
