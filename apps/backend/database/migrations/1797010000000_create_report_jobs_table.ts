import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * report_jobs 表：V2 报表生成任务（v2-reporting-system-upgrade）。
 *
 * 设计原则（D3）：
 * - 任务状态机：queued → running → succeeded/failed/cancelled
 * - 幂等 key：同一组织同一 key 禁止重复创建
 * - attempt：可恢复失败形成新 attempt，非覆盖
 * - errorCategory 用于分类可恢复/永久错误
 * - 应用内抽象，无外部队列依赖（V2 先不做 BullMQ/Redis）
 */
export default class extends BaseSchema {
  protected tableName = 'report_jobs'

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
      table.bigInteger('report_id').unsigned().nullable()
      table.bigInteger('version_id').unsigned().nullable()

      // 模板
      table.string('template_id', 40).notNullable()

      // 请求者
      table
        .bigInteger('requested_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 状态
      table.string('status', 15).notNullable().defaultTo('queued')
      table.check("status IN ('queued','running','succeeded','failed','cancelled')")

      // 重试
      table.integer('attempt').unsigned().notNullable().defaultTo(1)
      table.string('idempotency_key', 128).nullable().index()

      // 进度与错误
      table.string('progress', 255).nullable().comment('进度摘要')
      table.string('error_category', 30).nullable().comment('错误分类')
      table.text('error_detail').nullable()

      // 时间
      table.timestamp('started_at', { useTz: false }).nullable()
      table.timestamp('finished_at', { useTz: false }).nullable()

      // 审计
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 索引
      table.index(['project_id', 'status'], 'rj_project_status')
      table.index(['organization_id', 'project_id'], 'rj_org_project')
      table.index(['version_id'], 'rj_version_id')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
