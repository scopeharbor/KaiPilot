/**
 * v3-ai-request-tracing — AI 请求追踪 span 表。
 *
 * 分布式追踪 span 表，用于 AI 请求的全链路追踪与分析：
 * - span 树形结构（parent-child）组装与可视化
 * - 组织隔离 + 会话/工作流维度聚合
 * - 孤立 span 检测与关键路径标记
 * - 成本与 token 用量统计
 *
 * 低敏红线：不存 prompt/system instructions/模型输出全文/tool 参数结果/
 * 检索正文/原始 provider 载荷/token/secret/apiKey/Authorization。
 *
 * span_type 复用 LEDGER_OPERATION_NAMES：
 * chat/generate_content/text_completion/embeddings/execute_tool/
 * retrieval/invoke_agent/invoke_workflow/create_agent
 *
 * 索引：
 * - 组织隔离 + trace 查找：(organization_id, trace_id)
 * - span 树组装排序：(trace_id, started_at)
 * - 会话聚合：(organization_id, conversation_id)
 * - 工作流聚合：(organization_id, workflow_name)
 * - 单 span 查找：unique (span_id)
 * - parent-child 遍历：(parent_span_id)
 *
 * 方言兼容：全部使用 Lucid/knex 可移植 API（无 SQLite 专有语法），PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AiTraceSpansMigration extends BaseSchema {
  protected tableName = 'ai_trace_spans'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // ── 组织隔离 ──
      table.integer('organization_id').unsigned().notNullable()

      // ── 追踪身份 ──
      table.string('trace_id', 64).notNullable()
      table.string('span_id', 64).notNullable().unique('idx_trace_spans_span_id')
      table.string('parent_span_id', 64).nullable()

      // ── span 元数据 ──
      table
        .string('span_type', 32)
        .notNullable()
        .comment(
          '复用 LEDGER_OPERATION_NAMES: chat/generate_content/text_completion/embeddings/execute_tool/retrieval/invoke_agent/invoke_workflow/create_agent',
        )
      table.timestamp('started_at', { useTz: true }).notNullable()
      table.timestamp('ended_at', { useTz: true }).nullable()
      table.integer('duration_ms').unsigned().nullable()

      // ── 状态 ──
      table.string('status', 16).notNullable().comment('ok/error/cancelled/timeout/orphaned')
      table.string('error_kind', 32).nullable()
      table.string('error_ref', 128).nullable()

      // ── 关联 ──
      table.string('conversation_id', 128).nullable()
      table.string('workflow_name', 128).nullable()

      // ── 孤立与关键路径 ──
      table.boolean('is_orphan').notNullable().defaultTo(false)
      table.string('orphan_break_reason', 128).nullable()
      table.integer('self_duration_ms').unsigned().nullable()
      table.boolean('on_critical_path').notNullable().defaultTo(false)

      // ── 成本与用量 ──
      table.decimal('estimated_cost', 16, 10).nullable()
      table.integer('input_tokens').unsigned().nullable()
      table.integer('output_tokens').unsigned().nullable()

      // ── 扩展元数据（JSON，不存敏感内容） ──
      table.text('metadata').nullable()

      // ── 时间戳 ──
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // ── 索引 ──
      // 组织隔离 + trace 查找
      table.index(['organization_id', 'trace_id'], 'idx_trace_spans_org_trace')
      // span 树组装排序（按开始时间）
      table.index(['trace_id', 'started_at'], 'idx_trace_spans_trace_started')
      // 会话聚合
      table.index(['organization_id', 'conversation_id'], 'idx_trace_spans_org_conversation')
      // 工作流聚合
      table.index(['organization_id', 'workflow_name'], 'idx_trace_spans_org_workflow')
      // parent-child 遍历
      table.index(['parent_span_id'], 'idx_trace_spans_parent')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
