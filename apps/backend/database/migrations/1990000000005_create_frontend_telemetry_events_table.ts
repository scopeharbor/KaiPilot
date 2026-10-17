import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * frontend_telemetry_events 表：前端 AI 使用事件持久化（最小表）。
 *
 * v3-ai-quality-cost-console-deferred-p1 §3 / D4：
 * - 只存事件种类、会话 ID、类别与计数字段；不建任何用户标识列、
 *   不建跨会话拼接辅助列——schema 层面堵死画像路径；
 * - 组织隔离：organization_id 首列过滤 + 复合索引 (organization_id, occurred_at)；
 * - 禁存字段（userInput/prompt/modelOutput/token/secret 等）由服务层二次校验拒绝落库。
 */
export default class extends BaseSchema {
  protected tableName = 'frontend_telemetry_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 作用域
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 会话标识（仅用于会话内计数聚合，不做跨会话拼接）
      table.string('session_id', 128).notNullable()

      // 事件种类（panel_open/panel_close/session_turn/first_question_intent/
      // abandonment/chip_click/action_click/action_reject）
      table.string('event_kind', 32).notNullable()

      // 事件发生时间
      table.timestamp('occurred_at').notNullable()

      // 事件类别/计数载荷（按 event_kind 取用，均为类别与计数，无自由文本）
      table.boolean('has_submitted').nullable()
      table.integer('turn_count').unsigned().nullable()
      table.string('intent_class', 32).nullable()
      table.string('chip_id', 128).nullable()
      table.string('chip_source', 64).nullable()
      table.string('action_id', 128).nullable()
      table.string('action_label', 128).nullable()

      table.timestamp('created_at').notNullable()

      // 索引
      table.index(['organization_id', 'occurred_at'], 'idx_fte_org_occurred_at')
      table.index(['organization_id', 'session_id'], 'idx_fte_org_session')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
