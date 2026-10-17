import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 为 projects 表附加 settings JSON 列，承载工作日历等项目级配置（design D2）。
 * TODO-DEBT: DEBT-01 — V1 SQLite 用 json，V2 迁 PostgreSQL 时改为 jsonb 并加 GIN 索引。
 */
export default class extends BaseSchema {
  protected tableName = 'projects'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('settings').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('settings')
    })
  }
}
