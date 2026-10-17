import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * report_versions 表：V2 报表版本快照（v2-reporting-system-upgrade）。
 *
 * 设计原则（D1）：
 * - 每次生成报表都创建新版本，禁止静默覆盖
 * - 保存模板版本、参数、数据源 hash、snapshotHash、warnings、AI 草稿与审核状态
 * - 版本记录作为事实资产长期保留，导出文件作为派生记录（report_exports）
 * - 组织隔离：organization_id + project_id 双重边界
 */
export default class extends BaseSchema {
  protected tableName = 'report_versions'

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

      // V1 关联（兼容 bridge）
      table.bigInteger('report_id').unsigned().nullable().comment('关联 V1 reports.id')

      // 模板信息
      table.string('template_id', 40).notNullable()
      table.string('template_version', 10).notNullable()
      table.string('title', 255).notNullable()

      // 参数与范围
      table.json('date_range').nullable()
      table.json('filters').nullable()

      // 数据源 hash 集合（JSON：{sourceKey: hash}）
      table.json('data_source_hashes').nullable()
      table.string('snapshot_hash', 64).notNullable().comment('版本快照指纹')

      // Warnings 和文档
      table.json('warnings').nullable()
      table.json('document_ref').nullable().comment('文档部分或全文引用')

      // AI 草稿
      table.text('ai_draft').nullable().comment('AI 候选正文')
      table.string('ai_review_status', 20).nullable().defaultTo('pending_review')
      table.json('ai_cost_ref').nullable().comment('成本记录引用')

      // 生成者与时间
      table
        .bigInteger('generated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('generated_at', { useTz: false }).notNullable()

      // 确认状态（人工审核通过）
      table.timestamp('confirmed_at', { useTz: false }).nullable()
      table
        .bigInteger('confirmed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 审计时间戳
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 索引
      table.index(['project_id', 'template_id', 'generated_at'], 'rv_project_template_time')
      table.index(['organization_id', 'project_id'], 'rv_org_project')
      table.index(['report_id'], 'rv_report_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
