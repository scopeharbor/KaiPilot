/**
 * v3-unified-ai-invocation-ledger §3.1–3.4 — 统一 AI 调用账本表。
 *
 * 跨全部 AI 能力面的 per-call 调用账本，字段命名与 `packages/types/src/unified-ai-invocation-ledger.ts`
 * 契约保持一致：
 * - 标准遥测字段按 OTel GenAI 语义约定（semconv 1.44.0）对齐（裸 snake_case 列名）；
 * - 本地扩展维度带 `aiproj_` 前缀对应 `aiproj.*` 命名空间；
 * - 低敏红线：不存 prompt/system instructions/模型输出全文/messages/tool 参数结果/
 *   检索正文/原始 provider 载荷/token/secret/apiKey/Authorization；
 *   正文以 hash/ref/计数/状态表达。
 *
 * 索引：
 * - 组织隔离：`(organization_id, created_at)`；归属：`(organization_id, capability)`、
 *   `(organization_id, project_id)`；
 * - 限流窗口（供后续全局限流 change 计数）：`(organization_id, connection_id, model_id, created_at)`；
 * - 重试分组：`(idempotency_key, attempt_number)`；追踪：`(trace_id)`、`(conversation_id)`。
 *
 * 方言兼容：全部使用 Lucid/knex 可移植 API（无 SQLite 专有语法），PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class UnifiedAiInvocationLedgerTable extends BaseSchema {
  protected tableName = 'unified_ai_invocation_ledger'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // ── 归属与身份（本地扩展命名空间 aiproj.*） ──
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.integer('user_id').unsigned().nullable()
      table.integer('connection_id').unsigned().nullable()
      table.integer('model_id').unsigned().nullable()
      table.string('capability', 64).notNullable().defaultTo('general')
      table.string('surface', 64).notNullable().defaultTo('general')
      table.integer('attempt_number').unsigned().notNullable().defaultTo(1)
      table.boolean('using_real_adapter').notNullable().defaultTo(false)
      table.boolean('fallback_used').notNullable().defaultTo(false)
      table.string('source', 16).notNullable().defaultTo('unknown')

      // ── 生命周期 ──
      table.string('status', 16).notNullable().defaultTo('queued')
      table.string('error_kind', 32).notNullable().defaultTo('none')
      table.string('error_message_ref', 128).nullable()
      table.boolean('degraded').notNullable().defaultTo(false)

      // ── 标准遥测字段（gen_ai.* 对齐） ──
      table.string('operation_name', 32).notNullable().defaultTo('chat')
      table.string('provider_name', 128).notNullable().defaultTo('unknown')
      table.string('request_model', 128).notNullable().defaultTo('unknown')
      table.string('response_model', 128).nullable()
      table.string('response_id', 128).nullable()
      table.json('finish_reasons').nullable()
      table.string('output_type', 16).nullable()
      table.string('prompt_name', 128).nullable()
      table.string('tool_name', 128).nullable()
      table.string('tool_type', 32).nullable()
      table.string('tool_call_id', 128).nullable()
      table.string('data_source_id', 128).nullable()
      table.string('trace_id', 64).nullable()
      table.string('span_id', 64).nullable()
      table.string('parent_span_id', 64).nullable()
      table.string('conversation_id', 128).nullable()
      table.string('workflow_name', 128).nullable()
      table.string('agent_id', 128).nullable()
      table.string('agent_name', 128).nullable()
      table.string('agent_version', 32).nullable()
      table.string('idempotency_key', 64).nullable()

      // ── 延迟与用量 ──
      table.integer('time_to_first_chunk_ms').unsigned().nullable()
      table.integer('duration_ms').unsigned().nullable()
      table.integer('usage_input_tokens').unsigned().nullable()
      table.integer('usage_output_tokens').unsigned().nullable()
      table.integer('usage_cache_read_input_tokens').unsigned().nullable()
      table.integer('usage_cache_creation_input_tokens').unsigned().nullable()
      table.integer('usage_reasoning_output_tokens').unsigned().nullable()
      table.integer('audio_tokens').unsigned().nullable()
      table.integer('context_tokens').unsigned().nullable()
      table.integer('total_tokens').unsigned().nullable()

      // ── 成本估算（本地扩展命名空间） ──
      table.decimal('estimated_cost', 16, 10).nullable()
      table.string('currency', 8).nullable()
      table.string('cost_status', 24).nullable()
      table.string('pricing_snapshot_id', 64).nullable()

      // ── 内容指纹与决策引用 ──
      table.string('input_hash', 32).nullable()
      table.string('output_hash', 32).nullable()
      table.string('budget_decision_ref', 64).nullable()
      table.string('rate_limit_decision_ref', 64).nullable()

      // ── 桥接（§5） ──
      table.string('source_ledger_ref', 128).nullable()

      // ── 时间 ──
      table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // ── 索引 ──
      // 组织隔离（所有查询路径首列组织）
      table.index(['organization_id', 'created_at'], 'ledger_org_created_idx')
      table.index(['organization_id', 'capability'], 'ledger_org_capability_idx')
      table.index(['organization_id', 'project_id'], 'ledger_org_project_idx')
      // 限流窗口计数（供后续全局限流 change）
      table.index(
        ['organization_id', 'connection_id', 'model_id', 'created_at'],
        'ledger_org_conn_model_window_idx',
      )
      // 重试分组与追踪
      table.index(['idempotency_key', 'attempt_number'], 'ledger_retry_group_idx')
      table.index(['trace_id'], 'ledger_trace_idx')
      table.index(['conversation_id'], 'ledger_conversation_idx')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
