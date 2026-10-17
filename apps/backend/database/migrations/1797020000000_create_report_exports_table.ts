import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * report_exports 表：V2 报表导出记录（v2-reporting-system-upgrade）。
 *
 * 设计原则（D1/D4）：
 * - 导出是版本的派生产物，每个版本可多次导出不同格式
 * - 记录格式、MIME、大小、文件 hash、状态、错误分类
 * - 下载前二次权限校验（Policy），禁止直接暴露文件路径
 * - 文件可配置保留策略，版本元数据长期保留
 */
export default class extends BaseSchema {
  protected tableName = 'report_exports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目隔离
      table.bigInteger('organization_id').unsigned().notNullable().index()
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 关联报表与版本
      table.bigInteger('report_id').unsigned().notNullable().index()
      table.bigInteger('version_id').unsigned().nullable().index()

      // 格式
      table.string('format', 10).notNullable()
      table.check("format IN ('markdown','csv','pdf','xlsx')")

      // 状态
      table.string('status', 15).notNullable().defaultTo('pending')
      table.check("status IN ('pending','processing','completed','failed')")

      // 文件元数据
      table.string('file_hash', 64).nullable().comment('文件内容 SHA-256 前 64 位')
      table.bigInteger('file_size').unsigned().nullable().comment('字节数')
      table.string('mime_type', 100).nullable()
      table.string('file_path', 500).nullable().comment('服务端存储路径，不对外暴露')

      // 错误
      table.string('error_category', 30).nullable()

      // 创建者
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 时间
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('completed_at', { useTz: false }).nullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 索引
      table.index(['version_id', 'format'], 're_version_format')
      table.index(['organization_id', 'project_id'], 're_org_project')
      table.index(['status', 'created_at'], 're_status_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
