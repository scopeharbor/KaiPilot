/**
 * v3-unified-ai-feedback-ledger §3.1–3.3 — 统一 AI 反馈事件表。
 *
 * 跨全部 AI 能力面的人类反馈账本，字段命名与
 * `packages/types/src/unified-ai-feedback.ts` 契约保持一致。
 *
 * 低敏红线：不存 AI 提议正文、用户输入正文、prompt、模型输出、凭据。
 * 改动以字段名 + 幅度档 + hash 表达。
 *
 * 索引：
 * - 组织隔离 + 能力面 + 时间：(organization_id, capability_surface, created_at)
 * - 组织隔离 + 反馈类型：(organization_id, feedback_type)
 * - 被反馈对象引用：(artifact_kind, artifact_id)
 * - 幂等键：(idempotency_key) UNIQUE
 * - 去重键：(deduplication_key)
 *
 * 方言兼容：全部使用 Lucid/knex 可移植 API（无 SQLite 专有语法），PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class UnifiedAiFeedbackEventsTable extends BaseSchema {
  protected tableName = 'unified_ai_feedback_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // ── 归属 ──
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()

      // ── 被反馈对象引用 ──
      table.string('artifact_kind', 32).notNullable()
      table.string('artifact_id', 128).notNullable()
      table.string('capability_surface', 64).notNullable()

      // ── 反馈内容 ──
      table.string('feedback_type', 16).notNullable()
      table.string('rejection_reason', 32).nullable()
      table.json('modification_fingerprint').nullable()
      table.string('note', 512).nullable()

      // ── 指纹（禁存正文） ──
      table.string('proposed_content_hash', 64).nullable()
      table.string('final_content_hash', 64).nullable()

      // ── 来源与追踪 ──
      table.integer('actor_id').unsigned().notNullable()
      table.string('idempotency_key', 128).notNullable()
      table.string('source_endpoint', 64).notNullable()
      table.string('source_ref', 128).nullable()
      table.string('deduplication_key', 256).nullable()

      // ── 时间 ──
      table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // ── 索引 ──
      // 组织隔离 + 能力面 + 时间（聚合查询主路径）
      table.index(
        ['organization_id', 'capability_surface', 'created_at'],
        'feedback_org_surface_time_idx',
      )
      // 组织隔离 + 反馈类型（按类型聚合）
      table.index(['organization_id', 'feedback_type'], 'feedback_org_type_idx')
      // 被反馈对象引用（投影去重 + 关联查询）
      table.index(['artifact_kind', 'artifact_id'], 'feedback_artifact_idx')
      // 幂等键（防重复记录）
      table.unique(['idempotency_key'], { indexName: 'feedback_idempotency_idx' })
      // 去重键
      table.index(['deduplication_key'], 'feedback_dedup_idx')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
