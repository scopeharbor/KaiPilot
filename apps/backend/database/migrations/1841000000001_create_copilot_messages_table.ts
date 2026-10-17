import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * copilot_messages 表：Copilot 消息持久化
 * （v3-copilot-session-persistence-and-history §3.2）。
 *
 * 形状继承 triz_assistant_messages 的有界低敏范式：
 * - 稳定 message_id 唯一
 * - role CHECK 约束
 * - content_summary VARCHAR(1024) — schema 级约束，结构性放不下全文
 * - source_refs_json — 完整存活，不截断
 * - 序号唯一约束防重复
 *
 * 不存完整 prompt、完整模型输出、secret/token/Authorization header。
 */
export default class extends BaseSchema {
  protected tableName = 'copilot_messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 所属会话（外键）
      table
        .bigInteger('session_db_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('copilot_sessions')
        .onDelete('CASCADE')

      // 组织 ID（组织隔离冗余，避免 JOIN sessions 表）
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 稳定会话 ID（共享契约生成，用于跨重启关联）
      table.string('session_id', 64).notNullable()

      // 稳定消息 ID（共享契约生成，全局唯一）
      table.string('message_id', 64).notNullable().unique()

      // 消息角色（CHECK 约束，与 TRIZ 助手一致）
      table.string('role', 16).notNullable()
      table.check("role IN ('user','assistant','system')")

      // 有界低敏摘要（schema 约束长度，结构性放不下全文）
      table.string('content_summary', 1024).notNullable().defaultTo('')

      // 截断标记
      table.boolean('truncated').notNullable().defaultTo(false)

      // 来源引用 JSON 数组（完整存活，不截断）
      table.json('source_refs_json').notNullable().defaultTo('[]')

      // 路由决策 ID 引用
      table.string('route_decision_id', 64).nullable()

      // 动作 ID 引用
      table.string('action_id', 64).nullable()

      // 警告码 JSON 数组
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      // 降级原因
      table.string('degraded_reason', 48).nullable()

      // 成本引用（指向统一账本 attempt，不存成本数值）
      table.string('cost_ledger_ref', 128).nullable()

      // 序号（会话内单调递增）
      table.integer('sequence').notNullable()

      // 幂等键（派生自 input + sessionId + sourceHashes）
      table.string('idempotency_key', 128).nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()

      // 索引
      // 组织隔离 + 会话消息列表
      table.index(['organization_id', 'session_db_id'], 'idx_cm_org_session')
      // 会话消息按时间排序
      table.index(['session_db_id', 'created_at'], 'idx_cm_session_created')
      // 会话消息按序号排序
      table.index(['session_db_id', 'sequence'], 'idx_cm_session_sequence')
      // 幂等键查询（同会话内唯一）
      table.index(['session_db_id', 'idempotency_key'], 'idx_cm_session_idempotency')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
