import { BaseSchema } from '@adonisjs/lucid/schema'
import { isPgDialect } from './1839300000001_add_pg_org_fk_for_deferred_tables.js'

/**
 * copilot_memory_entries 表：Copilot 跨对话记忆条目
 * （v3-copilot-memory-user-and-project §3）。
 *
 * 三层 scope（user / project / organization）+ 组织隔离。
 * 记忆恒为 inference：不存 prompt 全文、模型输出全文、凭据或个人敏感信息。
 * basis_json 溯源引用会话与消息（JSON 软引用）；schema 级外键仅
 * basis_session_db_id → copilot_sessions（CASCADE 删除），不存在
 * basis_message_db_id 之类的消息级 FK 列。
 * 保留期字段预留，清理作业归 v3-observability-data-retention。
 */
export default class extends BaseSchema {
  protected tableName = 'copilot_memory_entries'

  async up() {
    // PostgreSQL：copilot_sessions 由更晚的 1841000000000 才创建，此处 inline FK 会触发
    // `relation "copilot_sessions" does not exist`（真实 GCP fresh PG 证据，MIGRATE_EXIT=1）。
    // PG 仅建列，FK 由 1841000000002_add_copilot_memory_basis_session_fk 在父表就位后补齐
    // （fk_cme_basis_session，ON DELETE CASCADE），最终 PG schema 完整性不变。
    // SQLite：CREATE TABLE 不校验被引用表存在性，保持既有 inline FK 契约不变（不回退）。
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

      // 项目 ID（project scope 时必填）
      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // actor ID（user scope 时绑定）
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 稳定记忆 ID（共享契约生成，组织内唯一）
      table.string('entry_id', 64).notNullable()

      // 记忆作用域
      table.string('memory_scope', 24).notNullable()
      table.check("memory_scope IN ('user','project','organization')")

      // 内容摘要（≤512 字符，不含凭据/敏感信息/全文）
      table.string('summary', 512).notNullable()

      // 标签 JSON 数组（用于注入选取）
      table.json('tags_json').notNullable().defaultTo('[]')

      // 置信度（0–1，由来源强度派生，禁止模型自报）
      table.float('confidence').notNullable()

      // 置信度来源强度
      table.string('confidence_source', 48).notNullable()

      // 来源引用 JSON 数组（会话与消息溯源）
      table.json('basis_json').notNullable().defaultTo('[]')

      // 来源会话引用（外键，删除会话时级联删除记忆）
      // PG 分支此处不带 .references()：见 up() 开头的 deferred FK 说明；
      // 保持 `table.` 完整链书写，使静态审计（fk_dependency_audit）可见两端差异。
      if (isPgDialect(this.db.dialect.name)) {
        table.bigInteger('basis_session_db_id').unsigned().nullable()
      } else {
        table
          .bigInteger('basis_session_db_id')
          .unsigned()
          .nullable()
          .references('id')
          .inTable('copilot_sessions')
          .onDelete('CASCADE')
      }

      // 当前状态
      table.string('status', 24).notNullable().defaultTo('candidate')
      table.check("status IN ('candidate','confirmed','edited','possibly_outdated','invalidated')")

      // 时效档
      table.string('validity_tier', 24).notNullable().defaultTo('medium')
      table.check("validity_tier IN ('ephemeral','short','medium','long','durable')")

      // 观察时间
      table.timestamp('observed_at').notNullable()

      // 最后确认时间（未确认则为空）
      table.timestamp('last_confirmed_at').nullable()

      // 保留期截止时间（清理作业消费）
      table.timestamp('retention_expires_at').nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // === 索引 ===

      // 组织内唯一
      table.unique(['organization_id', 'entry_id'], 'uq_cme_org_entry')

      // 组织隔离 + scope 选取
      table.index(['organization_id', 'memory_scope', 'status'], 'idx_cme_org_scope_status')

      // 组织 + 项目过滤
      table.index(['organization_id', 'project_id'], 'idx_cme_org_project')

      // 组织 + actor 过滤
      table.index(['organization_id', 'actor_id'], 'idx_cme_org_actor')

      // 时效选取（按 last_confirmed_at 排序）
      table.index(['organization_id', 'last_confirmed_at'], 'idx_cme_org_confirmed')

      // 来源会话引用（级联删除后追踪）
      table.index(['basis_session_db_id'], 'idx_cme_basis_session')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
