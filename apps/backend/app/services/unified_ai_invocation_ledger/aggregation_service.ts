/**
 * v3-unified-ai-invocation-ledger §6.1/6.2/6.4/6.7 — 只读组织级聚合 service。
 *
 * 支持按 organization / project / user / capability / model 对成本/token/延迟/失败率/降级率
 * 做 rollup：
 * - 有界窗口与分页：必须显式窗口（默认 30 天），禁止无界全表扫描；
 * - 组织隔离：全部查询路径首列 `organization_id` 过滤；
 * - 成本标注：响应 `costLabel: 'estimate'` 标明为估算而非计费金额；
 * - 空窗口：返回显式 empty 态（不伪装零故障健康）。
 *
 * 聚合主体复用共享契约纯函数 `aggregateLedgerAttempts`（本机可测、确定性），
 * 本 service 只负责：窗口分页查询 → DTO 转换 → 纯函数聚合。
 */

import type {
  LedgerAggregationDimension,
  LedgerAggregationResult,
  UnifiedAiInvocationAttempt,
} from '@aiproj/types'
import {
  aggregateLedgerAttempts,
  defaultLedgerWindowBounds,
  LEDGER_UNKNOWN_MARKER,
} from '@aiproj/types'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import { DateTime } from 'luxon'

export const LEDGER_AGGREGATION_DIMENSIONS: LedgerAggregationDimension[] = [
  'organization',
  'project',
  'user',
  'capability',
  'model',
]

/** 每页最大行数（有界分页，禁止无界扫描）。 */
export const LEDGER_AGGREGATION_MAX_ROWS = 10_000

export interface LedgerAggregationQuery {
  organizationId: number
  dimension: LedgerAggregationDimension
  windowStart?: string | null
  windowEnd?: string | null
  /** 有界分页：最大扫描行数。 */
  maxRows?: number
}

export default class UnifiedAiLedgerAggregationService {
  /**
   * 只读组织级聚合。默认窗口 = 最近 30 天；窗口必须显式有界。
   */
  async aggregate(input: LedgerAggregationQuery): Promise<LedgerAggregationResult> {
    const bounds =
      input.windowStart && input.windowEnd
        ? { startIso: input.windowStart, endIso: input.windowEnd }
        : defaultLedgerWindowBounds(30, new Date())

    // 组织隔离：首列 organization_id 过滤（§6.4）
    const query = UnifiedAiInvocationLedger.filterOrganization(input.organizationId)
      .where('occurred_at', '>=', DateTime.fromISO(bounds.startIso).toSQL()!)
      .where('occurred_at', '<=', DateTime.fromISO(bounds.endIso).toSQL()!)
      .limit(Math.min(input.maxRows ?? LEDGER_AGGREGATION_MAX_ROWS, LEDGER_AGGREGATION_MAX_ROWS))

    const rows = await query.orderBy('id', 'asc')

    const attempts: UnifiedAiInvocationAttempt[] = rows.map((r) => ({
      aiproj_organization_id: r.organizationId,
      aiproj_project_id: r.projectId,
      aiproj_user_id: r.userId,
      aiproj_connection_id: r.connectionId,
      aiproj_model_id: r.modelId,
      aiproj_capability: r.capability || LEDGER_UNKNOWN_MARKER,
      aiproj_surface: r.surface || LEDGER_UNKNOWN_MARKER,
      aiproj_attempt_number: r.attemptNumber,
      aiproj_using_real_adapter: r.usingRealAdapter,
      aiproj_fallback_used: r.fallbackUsed,
      aiproj_source: r.source as UnifiedAiInvocationAttempt['aiproj_source'],
      status: r.status,
      error_kind: (r.errorKind ?? 'none') as UnifiedAiInvocationAttempt['error_kind'],
      error_message_ref: r.errorMessageRef,
      aiproj_degraded: r.degraded,
      operation_name: r.operationName,
      provider_name: r.providerName,
      request_model: r.requestModel,
      response_model: r.responseModel,
      response_id: r.responseId,
      finish_reasons: r.finishReasons ?? [],
      output_type: (r.outputType ?? 'unknown') as UnifiedAiInvocationAttempt['output_type'],
      prompt_name: r.promptName,
      aiproj_prompt_version: r.promptVersion ?? null,
      tool_name: r.toolName,
      tool_type: r.toolType,
      tool_call_id: r.toolCallId,
      data_source_id: r.dataSourceId,
      trace_id: r.traceId,
      span_id: r.spanId,
      parent_span_id: r.parentSpanId,
      conversation_id: r.conversationId,
      workflow_name: r.workflowName,
      agent_id: r.agentId,
      agent_name: r.agentName,
      agent_version: r.agentVersion,
      idempotency_key: r.idempotencyKey,
      time_to_first_chunk_ms: r.timeToFirstChunkMs,
      duration_ms: r.durationMs,
      usage_input_tokens: r.usageInputTokens,
      usage_output_tokens: r.usageOutputTokens,
      usage_cache_read_input_tokens: r.usageCacheReadInputTokens,
      usage_cache_creation_input_tokens: r.usageCacheCreationInputTokens,
      usage_reasoning_output_tokens: r.usageReasoningOutputTokens,
      aiproj_audio_tokens: r.audioTokens,
      aiproj_context_tokens: r.contextTokens,
      aiproj_total_tokens: r.totalTokens,
      aiproj_estimated_cost: r.estimatedCost,
      aiproj_currency: r.currency,
      aiproj_cost_status:
        (r.costStatus as UnifiedAiInvocationAttempt['aiproj_cost_status']) ?? null,
      aiproj_pricing_snapshot_id: r.pricingSnapshotId,
      aiproj_input_hash: r.inputHash,
      aiproj_output_hash: r.outputHash,
      aiproj_budget_decision_ref: r.budgetDecisionRef,
      aiproj_rate_limit_decision_ref: r.rateLimitDecisionRef,
      aiproj_source_ledger_ref: r.sourceLedgerRef,
      occurred_at: r.occurredAt.toISO()!,
    }))

    return aggregateLedgerAttempts(attempts, input.dimension, bounds)
  }

  /**
   * 事件级分页列表（bounded）：供控制器回显明细。
   */
  async listEvents(input: {
    organizationId: number
    windowStart?: string | null
    windowEnd?: string | null
    page: number
    perPage: number
  }): Promise<{
    data: UnifiedAiInvocationAttempt[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const bounds =
      input.windowStart && input.windowEnd
        ? { startIso: input.windowStart, endIso: input.windowEnd }
        : defaultLedgerWindowBounds(30, new Date())
    const page = Math.max(1, input.page)
    const perPage = Math.min(Math.max(1, input.perPage), 200)

    const base = UnifiedAiInvocationLedger.filterOrganization(input.organizationId)
      .where('occurred_at', '>=', DateTime.fromISO(bounds.startIso).toSQL()!)
      .where('occurred_at', '<=', DateTime.fromISO(bounds.endIso).toSQL()!)

    const countResult = await base.clone().count('* as total')
    const total = Number(countResult[0]?.$extras?.total ?? 0)
    const rows = await base
      .clone()
      .orderBy('id', 'desc')
      .offset((page - 1) * perPage)
      .limit(perPage)

    const data = rows.map((r) => ({
      id: r.id,
      aiproj_organization_id: r.organizationId,
      aiproj_project_id: r.projectId,
      aiproj_user_id: r.userId,
      aiproj_capability: r.capability,
      aiproj_surface: r.surface,
      aiproj_attempt_number: r.attemptNumber,
      status: r.status,
      error_kind: r.errorKind,
      operation_name: r.operationName,
      provider_name: r.providerName,
      request_model: r.requestModel,
      response_model: r.responseModel,
      usage_input_tokens: r.usageInputTokens,
      usage_output_tokens: r.usageOutputTokens,
      aiproj_estimated_cost: r.estimatedCost,
      aiproj_currency: r.currency,
      aiproj_cost_status: r.costStatus,
      aiproj_source_ledger_ref: r.sourceLedgerRef,
      occurred_at: r.occurredAt.toISO()!,
    })) as unknown as UnifiedAiInvocationAttempt[]

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    }
  }
}
