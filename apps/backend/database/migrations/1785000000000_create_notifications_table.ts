import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notifications 表：站内通知持久化存储（notification-feedback-minimum）。
 *
 * 设计原则（D1）：
 * - 以 recipient_id 为主访问边界，与 organization_id 双重隔离
 * - 目标资源用多态 target_type/target_id 而非外键，支持任务/里程碑/报表等不同类型
 * - read_at 为空表示未读，幂等已读不改变归属
 * - idempotency_key 用于同一接收人同一事件短窗口去重（如重复指派）
 * - metadata JSON 存储事件额外上下文，不影响核心查询
 */
export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离
      table.bigInteger('organization_id').unsigned().notNullable().index().comment('组织隔离边界')

      // 接收人
      table
        .bigInteger('recipient_id')
        .unsigned()
        .notNullable()
        .index()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .comment('通知接收用户')

      // 事件类型
      table.string('type', 30).notNullable()
      table.check(
        "type IN ('task_assigned','task_unassigned','comment_added','attachment_added','project_archived','project_restored','milestone_due','milestone_overdue','ai_draft_confirmed','ai_draft_imported','report_exported','report_export_failed','general')",
      )

      // 内容
      table.string('title', 255).notNullable()
      table.text('body').nullable()

      // 严重级别
      table.string('severity', 10).notNullable().defaultTo('info')
      table.check("severity IN ('info','warning','error','critical')")

      // 可选：关联项目（用于权限过滤与跳转）
      table.bigInteger('project_id').unsigned().nullable()
      table.foreign('project_id').references('id').inTable('projects').onDelete('CASCADE')

      // 多态目标引用（跳转锚点）
      table.string('target_type', 30).nullable()
      table.bigInteger('target_id').unsigned().nullable()

      // 行动 URL（跳转目标，前端组装）
      table.string('action_url', 500).nullable()

      // 已读时间（null = 未读）
      table.timestamp('read_at', { useTz: false }).nullable().index()

      // 幂等键（同一接收人同一事件短窗口去重）
      table.string('idempotency_key', 128).nullable().index()

      // 事件额外上下文
      table.json('metadata').nullable()

      // 时间戳
      table.timestamp('created_at', { useTz: false }).notNullable().index()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 复合索引：列表查询核心路径
      table.index(['recipient_id', 'organization_id', 'created_at'])
      table.index(['recipient_id', 'read_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
