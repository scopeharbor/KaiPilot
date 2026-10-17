/**
 * UnifiedAiInvocationLedger 数据库迁移表结构 + Lucid 模型测试（v3-unified-ai-invocation-ledger §3.6–3.7）
 *
 * - 验证表存在、全部列存在（与共享契约字段一致）；
 * - 验证组织隔离/归属/限流窗口/重试分组/追踪索引存在；
 * - 验证 SQLite 兼容且不含任何内容型列（prompt/output/messages/token/secret/apiKey/authorization
 *   均不得以裸列存在——正文只以 hash/ref/计数/状态表达）；
 * - 模型创建/读取（camelCase ↔ snake_case 映射）与 org 过滤 scope。
 * - PG 迁移路径：迁移未使用 SQLite 专有语法（PRAGMA/FOREIGN KEY ON 仅测试用），
 *   全部 Lucid/knex 可移植 API；本 spec 在 SQLite 上执行并核对列/索引存在性。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import { unifiedAiInvocationAttemptFixture } from '@aiproj/types'

const TABLE = 'unified_ai_invocation_ledger'

async function tableColumns(table = TABLE): Promise<string[]> {
  const res = await db.rawQuery(`PRAGMA table_info('${table}')`)
  const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
  return rows.map((r: any) => r.name as string)
}

async function indexNames(table = TABLE): Promise<string[]> {
  const res = await db.rawQuery(`PRAGMA index_list('${table}')`)
  const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
  return rows.map((r: any) => r.name as string)
}

/** 契约字段 → 表列名映射（snake_case）。 */
const EXPECTED_COLUMNS = [
  'id',
  // 归属与身份
  'organization_id',
  'project_id',
  'user_id',
  'connection_id',
  'model_id',
  'capability',
  'surface',
  'attempt_number',
  'using_real_adapter',
  'fallback_used',
  'source',
  // 生命周期
  'status',
  'error_kind',
  'error_message_ref',
  'degraded',
  // 标准遥测
  'operation_name',
  'provider_name',
  'request_model',
  'response_model',
  'response_id',
  'finish_reasons',
  'output_type',
  'prompt_name',
  'prompt_version',
  'tool_name',
  'tool_type',
  'tool_call_id',
  'data_source_id',
  'trace_id',
  'span_id',
  'parent_span_id',
  'conversation_id',
  'workflow_name',
  'agent_id',
  'agent_name',
  'agent_version',
  'idempotency_key',
  // 延迟与用量
  'time_to_first_chunk_ms',
  'duration_ms',
  'usage_input_tokens',
  'usage_output_tokens',
  'usage_cache_read_input_tokens',
  'usage_cache_creation_input_tokens',
  'usage_reasoning_output_tokens',
  'audio_tokens',
  'context_tokens',
  'total_tokens',
  // 成本
  'estimated_cost',
  'currency',
  'cost_status',
  'pricing_snapshot_id',
  // 指纹与引用
  'input_hash',
  'output_hash',
  'budget_decision_ref',
  'rate_limit_decision_ref',
  // 桥接
  'source_ledger_ref',
  // 时间
  'occurred_at',
  'created_at',
  'updated_at',
]

/** 禁止出现的内容型列（低敏红线：正文只以 hash/ref/计数/状态表达）。 */
const FORBIDDEN_CONTENT_COLUMNS = [
  'prompt',
  'system_instruction',
  'completion',
  'output_text',
  'response_text',
  'messages',
  'tool_arguments',
  'tool_results',
  'retrieval_body',
  'raw_payload',
  'provider_payload',
  'api_key',
  'authorization',
  'secret',
  'password',
]

test.group('unified_ai_invocation_ledger 表结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('表存在', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='${TABLE}' AND name NOT LIKE 'sqlite_%'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    assert.isTrue(Number(rows[0]?.cnt ?? 0) > 0, 'unified_ai_invocation_ledger 表应存在')
  })

  test('包含全部契约列（与 §2 契约字段一致）', async ({ assert }) => {
    const columns = await tableColumns()
    for (const col of EXPECTED_COLUMNS) {
      assert.isTrue(columns.includes(col), `应包含列: ${col}`)
    }
  })

  test('不含任何内容型列（低敏红线）', async ({ assert }) => {
    const columns = await tableColumns()
    for (const forbidden of FORBIDDEN_CONTENT_COLUMNS) {
      assert.isFalse(columns.includes(forbidden), `禁止内容型列: ${forbidden}`)
    }
  })

  test('组织隔离/归属/限流窗口/重试/追踪索引存在', async ({ assert }) => {
    const indexes = await indexNames()
    for (const idx of [
      'ledger_org_created_idx',
      'ledger_org_capability_idx',
      'ledger_org_project_idx',
      'ledger_org_conn_model_window_idx',
      'ledger_retry_group_idx',
      'ledger_trace_idx',
      'ledger_conversation_idx',
    ]) {
      assert.isTrue(indexes.includes(idx), `应包含索引: ${idx}`)
    }
  })
})

test.group('UnifiedAiInvocationLedger model', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('create + 读取（camelCase ↔ snake_case 映射）', async ({ assert }) => {
    const input = unifiedAiInvocationAttemptFixture()
    const row = await UnifiedAiInvocationLedger.create({
      organizationId: input.aiproj_organization_id,
      projectId: input.aiproj_project_id,
      userId: input.aiproj_user_id,
      connectionId: input.aiproj_connection_id,
      modelId: input.aiproj_model_id,
      capability: input.aiproj_capability,
      surface: input.aiproj_surface,
      attemptNumber: input.aiproj_attempt_number,
      usingRealAdapter: input.aiproj_using_real_adapter,
      fallbackUsed: input.aiproj_fallback_used,
      source: input.aiproj_source,
      status: input.status,
      errorKind: input.error_kind,
      errorMessageRef: input.error_message_ref,
      degraded: input.aiproj_degraded,
      operationName: input.operation_name,
      providerName: input.provider_name,
      requestModel: input.request_model,
      responseModel: input.response_model,
      responseId: input.response_id,
      finishReasons: input.finish_reasons,
      outputType: input.output_type,
      promptName: input.prompt_name,
      toolName: input.tool_name,
      toolType: input.tool_type,
      toolCallId: input.tool_call_id,
      dataSourceId: input.data_source_id,
      traceId: input.trace_id,
      spanId: input.span_id,
      parentSpanId: input.parent_span_id,
      conversationId: input.conversation_id,
      workflowName: input.workflow_name,
      agentId: input.agent_id,
      agentName: input.agent_name,
      agentVersion: input.agent_version,
      idempotencyKey: input.idempotency_key,
      timeToFirstChunkMs: input.time_to_first_chunk_ms,
      durationMs: input.duration_ms,
      usageInputTokens: input.usage_input_tokens,
      usageOutputTokens: input.usage_output_tokens,
      usageCacheReadInputTokens: input.usage_cache_read_input_tokens,
      usageCacheCreationInputTokens: input.usage_cache_creation_input_tokens,
      usageReasoningOutputTokens: input.usage_reasoning_output_tokens,
      audioTokens: input.aiproj_audio_tokens,
      contextTokens: input.aiproj_context_tokens,
      totalTokens: input.aiproj_total_tokens,
      estimatedCost: input.aiproj_estimated_cost,
      currency: input.aiproj_currency,
      costStatus: input.aiproj_cost_status,
      pricingSnapshotId: input.aiproj_pricing_snapshot_id,
      inputHash: input.aiproj_input_hash,
      outputHash: input.aiproj_output_hash,
      budgetDecisionRef: input.aiproj_budget_decision_ref,
      rateLimitDecisionRef: input.aiproj_rate_limit_decision_ref,
      sourceLedgerRef: input.aiproj_source_ledger_ref,
      occurredAt: DateTime.fromISO(input.occurred_at),
    })

    const loaded = await UnifiedAiInvocationLedger.query().where('id', row.id).firstOrFail()
    assert.equal(loaded.organizationId, input.aiproj_organization_id)
    assert.equal(loaded.requestModel, input.request_model)
    assert.equal(loaded.responseModel, input.response_model)
    assert.equal(loaded.status, input.status)
    assert.equal(loaded.capability, input.aiproj_capability)
    assert.equal(loaded.operationName, input.operation_name)
    assert.equal(loaded.usageInputTokens, input.usage_input_tokens)
    assert.equal(loaded.estimatedCost, input.aiproj_estimated_cost)
    assert.deepEqual(loaded.finishReasons, input.finish_reasons)
  })

  test('org 过滤 scope：只返回本组织行', async ({ assert }) => {
    await UnifiedAiInvocationLedger.create({
      organizationId: 991,
      capability: 'draft',
      surface: 'draft',
      attemptNumber: 1,
      usingRealAdapter: true,
      fallbackUsed: false,
      source: 'user',
      status: 'succeeded',
      errorKind: 'none',
      degraded: false,
      operationName: 'chat',
      providerName: 'mock',
      requestModel: 'mock-model',
      responseModel: null,
      finishReasons: ['stop'],
      outputType: 'text',
      idempotencyKey: null,
      occurredAt: DateTime.now(),
    })

    const rows = await UnifiedAiInvocationLedger.filterOrganization(991)
    assert.isTrue(rows.length >= 1)
    for (const r of rows) {
      assert.equal(r.organizationId, 991)
    }
  })
})
