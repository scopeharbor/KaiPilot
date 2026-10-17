import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— communication_plans 沟通管理计划表（W1.2）。
 *
 * - owner_id → users ON DELETE RESTRICT：沟通事项责任人
 * - communication_type：meeting/report/email/instant_message
 * - frequency：daily/weekly/biweekly/monthly/milestone_driven/ad_hoc
 * - channel：in_person/video_conference/email/wechat_work/feishu/pdf_export
 * - report_template_key 关联既有周期报表模板标识（报表联动，不做 FK）
 * - is_active 启停开关（软关闭，不物理删除）
 *
 * 方言兼容：无 `.after()`；索引显式命名（≤ PostgreSQL 63 字节）。
 */
export default class extends BaseSchema {
  protected tableName = 'communication_plans'

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

      table
        .bigInteger('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      table.string('name', 255).notNullable()

      // meeting/report/email/instant_message
      table.string('communication_type', 30).notNullable().defaultTo('meeting')
      table.check("communication_type IN ('meeting','report','email','instant_message')")

      table.text('purpose').notNullable()

      // daily/weekly/biweekly/monthly/milestone_driven/ad_hoc
      table.string('frequency', 30).notNullable().defaultTo('weekly')
      table.check(
        "frequency IN ('daily','weekly','biweekly','monthly','milestone_driven','ad_hoc')",
      )

      // in_person/video_conference/email/wechat_work/feishu/pdf_export
      table.string('channel', 30).notNullable().defaultTo('video_conference')
      table.check(
        "channel IN ('in_person','video_conference','email','wechat_work','feishu','pdf_export')",
      )

      table.text('audience').notNullable()
      table.string('deliverable', 255).nullable()
      table.string('report_template_key', 64).nullable()
      table.boolean('is_active').notNullable().defaultTo(true)

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

      // 项目内启停状态过滤索引
      table.index(
        ['organization_id', 'project_id', 'is_active'],
        'idx_comm_plans_org_project_active',
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
