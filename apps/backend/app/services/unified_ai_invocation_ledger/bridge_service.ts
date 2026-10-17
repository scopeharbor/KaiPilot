/**
 * v3-unified-ai-invocation-ledger §5 —— 与既有账本（Compiler/OCR）的桥接服务。
 *
 * 语义（§5.1/5.2/5.3）：
 * - `source_ledger_ref` 标记统一账本行同时存在于 Compiler（`compiler:cost_event:<ref>`）
 *   或 OCR（`ocr:attempt:<id>`）来源账本；
 * - 桥接**只写统一账本侧的新行**，绝不修改 `compiler_artifacts` 与 `ocr_provider_attempts`
 *   任何既有行（两个来源账本的记录不删不重写）；
 * - 聚合去重：同一逻辑调用在统一账本与来源账本各有记录时只计一次
 *   （`dedupeLedgerAndSourceRows` 纯函数已定义于共享契约）。
 *
 * 本服务提供：
 * - `bridgeFromOcrAttempt`：把一条 OCR attempt 记录桥接为统一账本行（含 source_ledger_ref）；
 * - `bridgeFromCompilerCostEvent`：把一条 Compiler cost_event 桥接为统一账本行；
 * - `windowCountsFromUnifiedLedger`：按 ocr_rate_limit_guard 口径从统一账本计数
 *   （§5.5 fixture 对照测试用；限流计数迁移到统一账本是后续 change）。
 */

import type { LedgerAttemptStatus, LedgerOperationName } from '@aiproj/types'
import { normalizeLedgerErrorKind } from '@aiproj/types'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import { DateTime } from 'luxon'

export interface OcrAttemptBridgeSource {
  id: number
  organizationId: number
  projectId: number | null
  attemptNumber: number
  provider: string
  model: string
  connectionId: number | null
  modelId: number | null
  status: string
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  audioTokens: number | null
  reasoningTokens: number | null
  contextTokens: number | null
  estimatedCost: number | null
  currency: string | null
  costStatus: string | null
  pricingSnapshotId: string | null
  inputHash: string | null
  outputHash: string | null
  budgetDecisionRef: string | null
  rateLimitDecisionRef: string | null
  errorCategory: string | null
  idempotencyKey: string
  occurredAt: DateTime
}

export interface CompilerCostEventBridgeSource {
  organizationId: number
  compilerRunId: number
  provider: string
  model: string
  stageId: string
  attemptNumber: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  currency: string
  costStatus: string
  pricingSnapshotId: string | null
  latencyMs: number
  errorCategory: string
  idempotencyKey: string | null
  occurredAt: string | null
}

/**
 * OCR 状态 → 统一账本状态。
 *
 * 计数口径对齐 `ocr_rate_limit_guard.#countRecentAttempts`：
 * 该守卫只排除 `budget_blocked` 与 `skipped`（未真正发出的调用），其余状态
 * （含 rate_limited / capability_mismatch）都计为一次真实 attempt。
 * 因此：
 * - budget_blocked / skipped → `aborted`（统一账本计数时排除）；
 * - rate_limited / capability_mismatch → `failed`（仍计入 RPM/TPM，与 OCR 一致）；
 * - running → `in_flight`（瞬时态，窗口计数排除，与「未完成调用不计」口径一致）。
 */
export function ocrStatusToLedgerStatus(status: string): LedgerAttemptStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'running':
      return 'in_flight'
    case 'rate_limited':
    case 'capability_mismatch':
      return 'failed'
    case 'budget_blocked':
    case 'skipped':
      return 'aborted'
    default:
      return 'queued'
  }
}

export default class UnifiedAiLedgerBridgeService {
  /**
   * 把 OCR attempt 记录桥接为统一账本行。
   * 只写统一账本，不修改 `ocr_provider_attempts` 任何既有行。
   */
  async bridgeFromOcrAttempt(attempt: OcrAttemptBridgeSource): Promise<string> {
    const row = await UnifiedAiInvocationLedger.create({
      organizationId: attempt.organizationId,
      projectId: attempt.projectId,
      userId: null,
      connectionId: attempt.connectionId,
      modelId: attempt.modelId,
      capability: 'ocr',
      surface: 'ocr',
      attemptNumber: attempt.attemptNumber,
      usingRealAdapter: true,
      fallbackUsed: false,
      source: 'user',
      status: ocrStatusToLedgerStatus(attempt.status),
      errorKind: normalizeLedgerErrorKind(attempt.errorCategory),
      errorMessageRef: null,
      degraded: false,
      operationName: 'generate_content' as LedgerOperationName,
      providerName: attempt.provider,
      requestModel: attempt.model,
      responseModel: null,
      responseId: null,
      finishReasons: [],
      outputType: 'text',
      promptName: null,
      toolName: null,
      toolType: null,
      toolCallId: null,
      dataSourceId: null,
      traceId: null,
      spanId: null,
      parentSpanId: null,
      conversationId: null,
      workflowName: null,
      agentId: null,
      agentName: null,
      agentVersion: null,
      idempotencyKey: attempt.idempotencyKey,
      timeToFirstChunkMs: null,
      durationMs: attempt.latencyMs,
      usageInputTokens: attempt.inputTokens,
      usageOutputTokens: attempt.outputTokens,
      usageCacheReadInputTokens: attempt.cacheReadTokens,
      usageCacheCreationInputTokens: attempt.cacheWriteTokens,
      usageReasoningOutputTokens: attempt.reasoningTokens,
      audioTokens: attempt.audioTokens,
      contextTokens: attempt.contextTokens,
      totalTokens: attempt.totalTokens,
      estimatedCost: attempt.estimatedCost,
      currency: attempt.currency,
      costStatus: attempt.costStatus,
      pricingSnapshotId: attempt.pricingSnapshotId,
      inputHash: attempt.inputHash,
      outputHash: attempt.outputHash,
      budgetDecisionRef: attempt.budgetDecisionRef,
      rateLimitDecisionRef: attempt.rateLimitDecisionRef,
      sourceLedgerRef: `ocr:attempt:${attempt.id}`,
      occurredAt: attempt.occurredAt,
    })
    return `ledger:${row.id}`
  }

  /**
   * 把 Compiler cost_event 桥接为统一账本行。
   * 只写统一账本，不修改 `compiler_artifacts` 任何既有行。
   */
  async bridgeFromCompilerCostEvent(event: CompilerCostEventBridgeSource): Promise<string> {
    const row = await UnifiedAiInvocationLedger.create({
      organizationId: event.organizationId,
      projectId: null,
      userId: null,
      connectionId: null,
      modelId: null,
      capability: 'compiler',
      surface: 'compiler',
      attemptNumber: event.attemptNumber,
      usingRealAdapter: true,
      fallbackUsed: false,
      source: 'user',
      status: event.errorCategory && event.errorCategory !== 'none' ? 'failed' : 'succeeded',
      errorKind: normalizeLedgerErrorKind(event.errorCategory),
      errorMessageRef: null,
      degraded: false,
      operationName: 'generate_content' as LedgerOperationName,
      providerName: event.provider,
      requestModel: event.model,
      responseModel: null,
      responseId: null,
      finishReasons: [],
      outputType: 'text',
      promptName: null,
      toolName: null,
      toolType: null,
      toolCallId: null,
      dataSourceId: null,
      traceId: null,
      spanId: null,
      parentSpanId: null,
      conversationId: null,
      workflowName: null,
      agentId: null,
      agentName: null,
      agentVersion: null,
      idempotencyKey: event.idempotencyKey,
      timeToFirstChunkMs: null,
      durationMs: event.latencyMs || null,
      usageInputTokens: event.promptTokens || null,
      usageOutputTokens: event.completionTokens || null,
      usageCacheReadInputTokens: null,
      usageCacheCreationInputTokens: null,
      usageReasoningOutputTokens: null,
      audioTokens: null,
      contextTokens: null,
      totalTokens: event.totalTokens || null,
      estimatedCost: event.estimatedCost || null,
      currency: event.currency,
      costStatus: event.costStatus,
      pricingSnapshotId: event.pricingSnapshotId,
      inputHash: null,
      outputHash: null,
      budgetDecisionRef: null,
      rateLimitDecisionRef: null,
      sourceLedgerRef: `compiler:cost_event:${event.compilerRunId}:${event.stageId}`,
      occurredAt: event.occurredAt ? DateTime.fromISO(event.occurredAt) : DateTime.now(),
    })
    return `ledger:${row.id}`
  }

  /**
   * 按 ocr_rate_limit_guard 口径从统一账本计窗口内 RPM/TPM。
   * 与 `ocr_rate_limit_guard.#countRecentAttempts` 一致：
   * - org/provider/model 过滤；
   * - 排除 queued/in_flight/aborted（对应 OCR 的 budget_blocked/skipped/queued 不计）。
   */
  async windowCountsFromUnifiedLedger(input: {
    organizationId: number
    provider: string
    model: string
    windowStart: DateTime
  }): Promise<{ rpm: number; tpm: number }> {
    const rows = await UnifiedAiInvocationLedger.query()
      .where('organization_id', input.organizationId)
      .where('provider_name', input.provider)
      .where('request_model', input.model)
      .where('occurred_at', '>=', input.windowStart.toSQL()!)
      .whereNotIn('status', ['queued', 'in_flight', 'aborted'])

    let rpm = 0
    let tpm = 0
    for (const r of rows) {
      rpm++
      tpm += (r.usageInputTokens ?? 0) + (r.usageOutputTokens ?? 0)
    }
    return { rpm, tpm }
  }

  /** 供测试：清空统一账本表（等价 clearOcrRateLimitWindowForTests 语义）。 */
  static async clearForTests(): Promise<void> {
    await UnifiedAiInvocationLedger.query().delete()
  }
}
