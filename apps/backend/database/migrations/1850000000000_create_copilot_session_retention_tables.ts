/**
 * Copilot session retention tables — session 生命周期管理与清理审计。
 *
 * 四张表：
 *   1. copilot_session_retention_policies       — 保留策略（组织/项目级，UNIQUE 组合去重）
 *   2. copilot_session_retention_tombstones     — 墓碑记录（标记已删除会话的摘要）
 *   3. copilot_session_retention_deletion_records — 删除审计（谁/何时/为何删了哪个会话）
 *   4. copilot_session_retention_cleanup_runs   — 清理运行日志（批处理状态与计数）
 *
 * 方言兼容：使用 Lucid/knex 可移植 API，SQLite CHECK 约束通过 raw() 注入，
 * PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class CreateCopilotSessionRetentionTables extends BaseSchema {
  async up() {
    // ── 1. copilot_session_retention_policies ──
    this.schema.createTable('copilot_session_retention_policies', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.integer('retention_days').unsigned().notNullable().defaultTo(90)
      table.integer('enabled').notNullable().defaultTo(1)
      table.string('policy_hash', 255).notNullable()
      // knex 的列构造器没有 .raw()，CHECK 约束要走 table.check()（与仓库其余迁移一致）
      table.string('source', 16).notNullable()
      table.check("source IN ('organization', 'project')")
      table.integer('updated_by').unsigned().nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.unique(['organization_id', 'project_id'], {
        indexName: 'uq_retention_policies_org_project',
      })

      table.index(['organization_id'], 'idx_copilot_retention_policies_org')
      table.index(['organization_id', 'project_id'], 'idx_copilot_retention_policies_org_project')
    })

    // ── 2. copilot_session_retention_tombstones ──
    this.schema.createTable('copilot_session_retention_tombstones', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.string('original_session_id', 255).notNullable()
      table.string('tombstone_hash', 255).notNullable()
      table.integer('message_count').unsigned().notNullable().defaultTo(0)
      table.string('policy_hash', 255).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['organization_id'], 'idx_copilot_retention_tombstones_org')
      table.index(['original_session_id'], 'idx_copilot_retention_tombstones_session')
    })

    // ── 3. copilot_session_retention_deletion_records ──
    this.schema.createTable('copilot_session_retention_deletion_records', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.string('session_id', 255).notNullable()
      table.integer('session_db_id').unsigned().notNullable()
      table.string('trigger_reason', 32).notNullable()
      table.check(
        "trigger_reason IN ('retention_expired', 'user_requested', 'organization_requested')",
      )
      table.timestamp('deleted_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.integer('message_count').unsigned().notNullable().defaultTo(0)
      table.integer('tombstone_id').unsigned().nullable()
      table.string('policy_hash', 255).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['organization_id'], 'idx_copilot_retention_deletion_org')
      table.index(['session_id'], 'idx_copilot_retention_deletion_session')
      table.index(['trigger_reason'], 'idx_copilot_retention_deletion_reason')
    })

    // ── 4. copilot_session_retention_cleanup_runs ──
    this.schema.createTable('copilot_session_retention_cleanup_runs', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.string('run_key', 255).notNullable()
      table.string('status', 16).notNullable().defaultTo('running')
      table.check("status IN ('running', 'completed', 'failed')")
      table.string('policy_hash', 255).notNullable()
      table.integer('expired_count').unsigned().notNullable().defaultTo(0)
      table.integer('tombstone_count').unsigned().notNullable().defaultTo(0)
      table.integer('blocked_count').unsigned().notNullable().defaultTo(0)
      table.integer('executed_by').unsigned().nullable()
      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('completed_at', { useTz: true }).nullable()
      table.text('failure_reason').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.unique(['organization_id', 'project_id', 'run_key'], {
        indexName: 'uq_cleanup_runs_org_project_key',
      })

      table.index(['organization_id'], 'idx_copilot_retention_cleanup_org')
    })
  }

  async down() {
    this.schema.dropTableIfExists('copilot_session_retention_cleanup_runs')
    this.schema.dropTableIfExists('copilot_session_retention_deletion_records')
    this.schema.dropTableIfExists('copilot_session_retention_tombstones')
    this.schema.dropTableIfExists('copilot_session_retention_policies')
  }
}
