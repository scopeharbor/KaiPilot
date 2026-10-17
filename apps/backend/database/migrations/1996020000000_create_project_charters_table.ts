import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— project_charters 项目章程表（W1.2）。
 *
 * 字段结构对齐 AI 草案 charter 规范（title/vision/scope/objectives/success_criteria/
 * start_date/end_date），补充治理生命周期字段（business_case 与审批状态机）。
 *
 * - project_id 唯一（每项目至多一份现行章程），ON DELETE CASCADE
 * - objectives / success_criteria 为字符串数组 JSON（TEXT 方言下亦为 JSON 语义，
 *   模型层 prepare/consume 序列化）
 * - approval_status 状态机：draft → pending_approval → approved / rejected
 * - approved_by → users ON DELETE SET NULL；created_by RESTRICT / updated_by SET NULL
 * - 版本号 version 由服务层递增（默认 1）
 *
 * 方言兼容：无 `.after()`；索引显式命名（≤ PostgreSQL 63 字节）。
 */
export default class extends BaseSchema {
  protected tableName = 'project_charters'

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
      table.unique(['project_id'])

      // 对齐 AI 草案 charter 结构
      table.string('title', 255).notNullable()
      table.text('vision').notNullable()
      table.text('scope').notNullable()
      table.json('objectives').notNullable()
      table.json('success_criteria').notNullable()
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()

      // 治理与审批
      table.text('business_case').nullable()
      table.string('approval_status', 20).notNullable().defaultTo('draft')
      table.check("approval_status IN ('draft','pending_approval','approved','rejected')")
      table
        .bigInteger('approved_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('approved_at').nullable()
      table.integer('version').notNullable().defaultTo(1)

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

      // 组织维度的项目章程查询加速索引
      table.index(['organization_id', 'project_id'], 'idx_charters_org_project')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
