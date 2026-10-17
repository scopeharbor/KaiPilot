/**
 * v3-unified-ai-invocation-ledger §4.1/4.4/4.6/4.8/4.10 — 统一 AI 调用账本 recorder service。
 *
 * 职责：
 * - 接受 attempt 记录并落盘（DB writer 可注入，测试免数据库）；
 * - 从 `resolveAdapter` 三处构造点接线（在 resolver 层构建 gateway 时携带 recorder + 调用上下文）；
 * - attempt 重试记录：同 `idempotency_key` 递增 `attempt_number`，每次尝试独立落账（由调用方传 attempt_number，
 *   本 service 负责校验同 key 下 attempt_number 递增并独立写入）；
 * - instrumentation 失败隔离：recorder 抛错**不得**回滚业务事件、不得改变草案/Compiler/OCR 终态、
 *   不得触发业务重试或自动确认——失败降级为计数 + 稳定错误码；
 * - 低敏红线：落盘前整体体检，命中禁止键时拒绝写入并计入 instrumentation 错误。
 *
 * 稳定错误码（供后续告警 change 消费）：
 * - `LEDGER_ERR_WRITE_FAILED`：DB 写入抛错
 * - `LEDGER_ERR_FORBIDDEN_CONTENT`：载荷命中禁止键（prompt/token/secret/…）
 * - `LEDGER_ERR_INVALID_STATUS`：未知 attempt 状态
 * - `LEDGER_ERR_ATTEMPT_DUPLICATE_OR_OUT_OF_ORDER`：同 key 下 attempt_number 未递增/重复
 */

import type { UnifiedAiInvocationAttempt } from '@aiproj/types'
import {
  assertLedgerAttemptStatus,
  estimateAiModelCatalogCost,
  isLedgerOperationName,
  ledgerFindDisallowedKeys,
  type BudgetCostStatus,
} from '@aiproj/types'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import {
  costStatusFor,
  resolveAttemptPricingSafely,
} from '#services/ai_pricing/model_pricing_service'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

/** 稳定错误码常量（instrumentation 错误计数用）。 */
export const LEDGER_ERR_WRITE_FAILED = 'LEDGER_ERR_WRITE_FAILED'
export const LEDGER_ERR_FORBIDDEN_CONTENT = 'LEDGER_ERR_FORBIDDEN_CONTENT'
export const LEDGER_ERR_INVALID_STATUS = 'LEDGER_ERR_INVALID_STATUS'
export const LEDGER_ERR_ATTEMPT_DUPLICATE_OR_OUT_OF_ORDER =
  'LEDGER_ERR_ATTEMPT_DUPLICATE_OR_OUT_OF_ORDER'

/** 可注入的账本 writer 接口（测试可用内存实现免数据库）。 */
export interface AiInvocationLedgerWriter {
  record(attempt: UnifiedAiInvocationAttempt): Promise<string>
}

/** 内存 writer（测试用）：收集记录，不落盘。 */
export class InMemoryLedgerWriter implements AiInvocationLedgerWriter {
  public records: UnifiedAiInvocationAttempt[] = []
  async record(attempt: UnifiedAiInvocationAttempt): Promise<string> {
    this.records.push(attempt)
    return `memory:${this.records.length}`
  }
}

/** instrumentation 错误计数器（进程内；供告警 change 消费）。 */
export interface LedgerInstrumentationErrorCounter {
  increment(code: string): void
  counts(): Record<string, number>
}

export class InMemoryInstrumentationCounter implements LedgerInstrumentationErrorCounter {
  private map = new Map<string, number>()
  increment(code: string): void {
    this.map.set(code, (this.map.get(code) ?? 0) + 1)
  }
  counts(): Record<string, number> {
    return Object.fromEntries(this.map)
  }
}

export interface UnifiedAiInvocationRecorderOptions {
  writer?: AiInvocationLedgerWriter | null
  counter?: LedgerInstrumentationErrorCounter | null
  /** 是否默认使用 DB writer（写模型）。默认为 true；测试传 false 免数据库。 */
  useDatabaseWriter?: boolean
}

/**
 * 统一 AI 调用账本 recorder。
 *
 * 失败隔离语义：`record()` 内部任何异常都不得向外抛出——写失败/校验失败均降级为
 * instrumentation 错误计数（稳定错误码），保证调用方（草案/Compiler/OCR 终态与人工确认）不受影响。
 */
/**
 * 丢弃一条账本记录时打低敏警告（只含错误码、能力面与原因，不含提示词/输出）。
 * 此前只在内存计数，AI 同事对话长期不进账本、用量页漏算却无从排查。
 */
function warnDropped(
  code: string,
  attempt: UnifiedAiInvocationAttempt,
  detail: Record<string, unknown>,
): void {
  logger.warn(
    {
      code,
      organizationId: attempt.aiproj_organization_id,
      capability: attempt.aiproj_capability,
      surface: attempt.aiproj_surface,
      ...detail,
    },
    'AI 调用账本记录被丢弃',
  )
}

export default class UnifiedAiInvocationRecorder {
  readonly #writer: AiInvocationLedgerWriter
  readonly #counter: LedgerInstrumentationErrorCounter

  constructor(options: UnifiedAiInvocationRecorderOptions = {}) {
    const useDb = options.useDatabaseWriter !== false
    this.#writer =
      options.writer ?? (useDb ? new DatabaseLedgerWriter() : new InMemoryLedgerWriter())
    this.#counter = options.counter ?? new InMemoryInstrumentationCounter()
  }

  /** 供测试/告警读取 error counter。 */
  get instrumentationCounts(): Record<string, number> {
    return this.#counter.counts()
  }

  /**
   * 落账一次 attempt。失败隔离：全部异常转为 instrumentation 错误计数，绝不外抛。
   * @returns 成功返回记录 ref（`ledger:<id>` 或 writer 返回串）；失败返回 null。
   */
  async record(attempt: UnifiedAiInvocationAttempt): Promise<string | null> {
    // 状态校验：未知状态拒绝（不落账、不计数为成功）
    try {
      assertLedgerAttemptStatus(attempt.status)
    } catch {
      this.#counter.increment(LEDGER_ERR_INVALID_STATUS)
      warnDropped(LEDGER_ERR_INVALID_STATUS, attempt, { status: attempt.status })
      return null
    }

    if (attempt.operation_name && !isLedgerOperationName(attempt.operation_name)) {
      this.#counter.increment(LEDGER_ERR_INVALID_STATUS)
      warnDropped(LEDGER_ERR_INVALID_STATUS, attempt, { operationName: attempt.operation_name })
      return null
    }

    // 低敏体检：结构化 DTO 只允许白名单键（content 不能以任何形态进入）
    const disallowed = ledgerFindDisallowedKeys(attempt)
    if (disallowed.length > 0) {
      this.#counter.increment(LEDGER_ERR_FORBIDDEN_CONTENT)
      warnDropped(LEDGER_ERR_FORBIDDEN_CONTENT, attempt, { keys: disallowed })
      return null
    }

    try {
      const ref = await this.#writer.record(attempt)
      return ref
    } catch (error) {
      this.#counter.increment(LEDGER_ERR_WRITE_FAILED)
      warnDropped(LEDGER_ERR_WRITE_FAILED, attempt, {
        // knex 报错形如「<SQL> - <数据库错误>」：只取数据库错误部分
        reason:
          error instanceof Error
            ? (error.message.split(' - ').pop() ?? error.message).slice(0, 300)
            : String(error),
      })
      return null
    }
  }
}

/** 整数列兜底取整：上游偶有小数（耗时/估算 token），PG 整数列会整行拒收。 */
const toInt = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null

/** 默认 DB writer：通过 Lucid 模型落盘。 */
export class DatabaseLedgerWriter implements AiInvocationLedgerWriter {
  async record(attempt: UnifiedAiInvocationAttempt): Promise<string> {
    // 重试顺序校验：同 idempotency_key 最近一条 attempt_number 必须小于新行（防止乱序/重复）
    let latestNumber: number | null = null
    if (attempt.idempotency_key) {
      const latest = await UnifiedAiInvocationLedger.query()
        .where('idempotency_key', attempt.idempotency_key)
        .where('organization_id', attempt.aiproj_organization_id)
        .orderBy('attempt_number', 'desc')
        .first()
      latestNumber = latest?.attemptNumber ?? null
    }
    if (latestNumber !== null && attempt.aiproj_attempt_number <= latestNumber) {
      // 重复/乱序 attempt：不落账，抛错由 recorder 隔离为 instrumentation 错误。
      throw new Error(LEDGER_ERR_ATTEMPT_DUPLICATE_OR_OUT_OF_ORDER)
    }

    // ── 成本归属（2026-10-01）──
    // AIGateway 侧把成本四字段写死为 null，用量页成本因此恒为「未定价」。
    // 这里按 connection_id/model_id 解析定价快照（账本里这两个字段常为空，再按模型名回落），
    // 现算成本后落库。解析或计算失败一律降级为未定价——账本写入不得因此失败。
    const pricing = await resolveAttemptPricingSafely({
      organizationId: attempt.aiproj_organization_id,
      connectionId: attempt.aiproj_connection_id,
      modelId: attempt.aiproj_model_id,
      requestModel: attempt.request_model,
      responseModel: attempt.response_model,
    })
    const costEstimate = pricing
      ? estimateAiModelCatalogCost({
          usage: {
            inputTokens: attempt.usage_input_tokens ?? undefined,
            outputTokens: attempt.usage_output_tokens ?? undefined,
            cacheReadTokens: attempt.usage_cache_read_input_tokens ?? undefined,
            cacheWriteTokens: attempt.usage_cache_creation_input_tokens ?? undefined,
            reasoningTokens: attempt.usage_reasoning_output_tokens ?? undefined,
          },
          cost: pricing.cost,
          currency: pricing.currency,
        })
      : null
    const estimatedCost = attempt.aiproj_estimated_cost ?? costEstimate?.estimatedCost ?? null
    const currency =
      attempt.aiproj_currency ?? (estimatedCost === null ? null : (pricing?.currency ?? null))
    const pricingSnapshotId = attempt.aiproj_pricing_snapshot_id ?? pricing?.snapshotId ?? null
    const costStatus: BudgetCostStatus = attempt.aiproj_cost_status ?? costStatusFor(estimatedCost)

    const row = await UnifiedAiInvocationLedger.create({
      organizationId: attempt.aiproj_organization_id,
      projectId: attempt.aiproj_project_id,
      userId: attempt.aiproj_user_id,
      connectionId: attempt.aiproj_connection_id,
      modelId: attempt.aiproj_model_id,
      capability: attempt.aiproj_capability || 'unknown',
      surface: attempt.aiproj_surface || 'unknown',
      attemptNumber: attempt.aiproj_attempt_number,
      usingRealAdapter: attempt.aiproj_using_real_adapter,
      fallbackUsed: attempt.aiproj_fallback_used,
      source: attempt.aiproj_source || 'unknown',
      status: attempt.status,
      errorKind: attempt.error_kind || 'none',
      errorMessageRef: attempt.error_message_ref,
      degraded: attempt.aiproj_degraded,
      operationName: attempt.operation_name,
      providerName: attempt.provider_name,
      requestModel: attempt.request_model,
      responseModel: attempt.response_model,
      responseId: attempt.response_id,
      finishReasons: attempt.finish_reasons,
      outputType: attempt.output_type,
      promptName: attempt.prompt_name,
      promptVersion: attempt.aiproj_prompt_version,
      toolName: attempt.tool_name,
      toolType: attempt.tool_type,
      toolCallId: attempt.tool_call_id,
      dataSourceId: attempt.data_source_id,
      traceId: attempt.trace_id,
      spanId: attempt.span_id,
      parentSpanId: attempt.parent_span_id,
      conversationId: attempt.conversation_id,
      workflowName: attempt.workflow_name,
      agentId: attempt.agent_id,
      agentName: attempt.agent_name,
      agentVersion: attempt.agent_version,
      idempotencyKey: attempt.idempotency_key,
      timeToFirstChunkMs: toInt(attempt.time_to_first_chunk_ms),
      durationMs: toInt(attempt.duration_ms),
      usageInputTokens: toInt(attempt.usage_input_tokens),
      usageOutputTokens: toInt(attempt.usage_output_tokens),
      usageCacheReadInputTokens: attempt.usage_cache_read_input_tokens,
      usageCacheCreationInputTokens: attempt.usage_cache_creation_input_tokens,
      usageReasoningOutputTokens: attempt.usage_reasoning_output_tokens,
      audioTokens: attempt.aiproj_audio_tokens,
      contextTokens: attempt.aiproj_context_tokens,
      totalTokens: toInt(attempt.aiproj_total_tokens),
      estimatedCost,
      currency,
      costStatus,
      pricingSnapshotId,
      pricingApproximate: pricing?.approximate ?? null,
      pricingMatchedBy: pricing?.matchedBy ?? null,
      inputHash: attempt.aiproj_input_hash,
      outputHash: attempt.aiproj_output_hash,
      budgetDecisionRef: attempt.aiproj_budget_decision_ref,
      rateLimitDecisionRef: attempt.aiproj_rate_limit_decision_ref,
      sourceLedgerRef: attempt.aiproj_source_ledger_ref,
      occurredAt: attempt.occurred_at ? DateTime.fromISO(attempt.occurred_at) : DateTime.now(),
    })
    return `ledger:${row.id}`
  }
}
