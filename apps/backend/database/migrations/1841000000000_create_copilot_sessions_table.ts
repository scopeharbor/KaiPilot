import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * copilot_sessions 表：Copilot 会话持久化
 * （v3-copilot-session-persistence-and-history §3.1）。
 *
 * 形状继承 triz_assistant_runs 的有界低敏范式。
 * 组织隔离 + scope + 归属引用 + 状态 + 标题 + 归档标记 + 幂等键 + 保留期字段。
 * 不存完整 prompt、完整模型输出、secret/token/Authorization header。
 */
export default class extends BaseSchema {
  protected tableName = 'copilot_sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离（必填）
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // scope（继承共享契约 CopilotScope 枚举）
      table.string('scope', 24).notNullable().defaultTo('project')
      table.check("scope IN ('global','organization','project','portfolio','entity')")

      // 归属引用（JSON 存储 CopilotSessionAttribution）
      table.json('attribution_json').notNullable().defaultTo('{}')

      // 状态（继承共享契约 CopilotSessionStatus 枚举）
      table.string('status', 24).notNullable().defaultTo('active')
      table.check("status IN ('active','completed','completed_with_warnings','failed','archived')")

      // 标题（用户命名或确定性派生，不调模型）
      table.string('title', 256).notNullable().defaultTo('新会话')

      // 归档标记（软状态，不删历史）
      table.boolean('archived').notNullable().defaultTo(false)

      // 创建者
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 稳定会话 ID（共享契约生成，全局唯一）
      table.string('session_id', 64).notNullable().unique()

      // 幂等键
      table.string('idempotency_key', 128).notNullable()

      // 保留期字段（§2.7 — 本 change 不实现清理作业）
      table.timestamp('retention_expires_at').nullable()
      table.timestamp('last_cleanup_check_at').nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      // 组织隔离 + 列表排序
      table.index(['organization_id', 'updated_at'], 'idx_cps_org_updated')
      // 组织 + actor 过滤
      table.index(['organization_id', 'actor_id'], 'idx_cps_org_actor')
      // 组织 + scope 过滤
      table.index(['organization_id', 'scope'], 'idx_cps_org_scope')
      // 组织 + archived 过滤
      table.index(['organization_id', 'archived'], 'idx_cps_org_archived')
      // 幂等键唯一
      table.unique(['organization_id', 'idempotency_key'], 'uq_cs_idempotency')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
