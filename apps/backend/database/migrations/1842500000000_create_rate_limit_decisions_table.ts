/**
 * v3-global-ai-rate-limiting §3.1–3.3 — 限流决策表。
 *
 * 记录限流决策：窗口、维度、限额、当前计数、预估增量、决策结果、重试建议、触发层、幂等键。
 * 字段命名与 `packages/types/src/global-ai-rate-limit.ts` 契约保持一致。
 *
 * 索引：
 * - 组织隔离与窗口：`(organization_id, dimension, window_start)`；
 * - 幂等：`(idempotency_key)` 防止同一 attempt 重复结算；
 * - 查询：`(organization_id, created_at)`。
 *
 * 方言兼容：全部使用 Lucid/knex 可移植 API（无 SQLite 专有语法），PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class RateLimitDecisionsTable extends BaseSchema {
  protected tableName = 'rate_limit_decisions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // ── 归属与身份 ──
      table.integer('organization_id').unsigned().notNullable()
      table.integer('connection_id').unsigned().nullable()
      table.integer('model_id').unsigned().nullable()
      table.integer('actor_id').unsigned().nullable()

      // ── 窗口 ──
      table.timestamp('window_start', { useTz: true }).notNullable()
      table.timestamp('window_end', { useTz: true }).notNullable()

      // ── 维度与限额 ──
      table.string('dimension', 8).notNullable() // 'rpm' | 'tpm'
      table.string('layer', 16).notNullable() // 'connection' | 'model' | 'organization' | 'actor'
      table.integer('limit').nullable() // null = 未设限

      // ── 计数与预估 ──
      table.integer('current_count').notNullable().defaultTo(0)
      table.integer('estimated_delta').nullable() // 仅 TPM

      // ── 决策结果 ──
      table.string('decision', 16).notNullable() // 'allow' | 'throttle' | 'reject'
      table.integer('retry_after_seconds').nullable()
      table.string('triggering_layer', 16).nullable() // 多层叠加时取最严格者

      // ── 幂等键 ──
      table.string('idempotency_key', 64).notNullable()

      // ── 时间 ──
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // ── 索引 ──
      // 组织隔离与窗口（所有查询路径首列组织）
      table.index(['organization_id', 'dimension', 'window_start'], 'rate_limit_org_dim_window_idx')
      // 幂等（防止同一 attempt 重复结算）
      table.index(['idempotency_key'], 'rate_limit_idempotency_idx')
      // 查询（组织级聚合）
      table.index(['organization_id', 'created_at'], 'rate_limit_org_created_idx')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
