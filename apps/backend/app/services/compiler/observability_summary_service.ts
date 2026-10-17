/**
 * @aiproj/backend —— CompilerObservabilitySummaryService（tasks 4.1, 4.2, 4.5）。
 *
 * 基于持久化 observability event、cost event、Ledger evidence 和 artifact refs
 * 聚合 Compiler run/stage 级摘要。摘要基于持久化数据，禁止依赖进程内计数。
 *
 * Resume 后聚合必须包含恢复前后的持久化事件，禁止重复计算已幂等写入的 attempt。
 *
 * @aiproj/backend
 */

import type { CompilerObservabilityRecorder } from './observability_recorder.js'
import {
  type ObservabilitySummary,
  type CostSummaryItem,
  type TokenSummaryItem,
  type LatencySummaryItem,
  type RetrySummaryItem,
  type CacheCutSummary,
  type ModelBreakdownItem,
  type ErrorBreakdownItem,
  type ModelCostEvent,
  type BudgetDecision,
} from '@aiproj/compiler-spec'

export interface SummaryQuery {
  compilerRunId: number
  organizationId: number
  stageId?: string
}

/**
 * CompilerObservabilitySummaryService —— 可观测摘要聚合服务。
 *
 * 聚合维度：
 * - 成本：total、by_stage、by_model
 * - token：total、by_stage、by_model
 * - 延迟：total、by_stage、by_model
 * - 重试：total、by_stage、by_model
 * - 缓存/裁剪：cache hit/cut count
 * - 模型分布：provider/model breakdown
 * - 错误分布：error category breakdown
 * - 预算状态：最近预算决策
 */
export class CompilerObservabilitySummaryService {
  readonly #recorder: CompilerObservabilityRecorder

  constructor(recorder: CompilerObservabilityRecorder) {
    this.#recorder = recorder
  }

  /**
   * 获取 Compiler run 级摘要。
   * Resume 后调用会基于持久化事件重新聚合，不会重复计算。
   */
  async getRunSummary(query: SummaryQuery): Promise<ObservabilitySummary> {
    const { compilerRunId, organizationId } = query

    const costEvents = await this.#recorder.getCostEvents(compilerRunId, organizationId)
    const budgetDecisions = await this.#recorder.getBudgetDecisions(compilerRunId, organizationId)
    const stageEvents = await this.#recorder.getStageEvents(compilerRunId, organizationId)

    return this.#aggregateSummary({
      compilerRunId,
      organizationId,
      costEvents,
      budgetDecisions,
      stageEvents,
    })
  }

  /**
   * 获取 Stage 级摘要。
   */
  async getStageSummary(query: SummaryQuery): Promise<ObservabilitySummary | null> {
    const { compilerRunId, organizationId, stageId } = query
    if (!stageId) return null

    const allCostEvents = await this.#recorder.getCostEvents(compilerRunId, organizationId)
    const allBudgetDecisions = await this.#recorder.getBudgetDecisions(
      compilerRunId,
      organizationId,
    )
    const allStageEvents = await this.#recorder.getStageEvents(compilerRunId, organizationId)

    const costEvents = allCostEvents.filter((e) => e.stageId === stageId)
    const budgetDecisions = allBudgetDecisions.filter((d) => d.stageId === stageId)
    const stageEvents = allStageEvents.filter((e) => e.stageId === stageId)

    if (costEvents.length === 0 && stageEvents.length === 0) return null

    return this.#aggregateSummary({
      compilerRunId,
      organizationId,
      stageId,
      costEvents,
      budgetDecisions,
      stageEvents,
    })
  }

  /**
   * 聚合摘要。
   */
  #aggregateSummary(params: {
    compilerRunId: number
    organizationId: number
    stageId?: string
    costEvents: ModelCostEvent[]
    budgetDecisions: BudgetDecision[]
    stageEvents: any[]
  }): ObservabilitySummary {
    const { compilerRunId, stageId, costEvents, budgetDecisions, stageEvents } = params

    // ── 成本摘要 ──
    const costSummary = this.#buildCostSummary(costEvents)
    const tokenSummary = this.#buildTokenSummary(costEvents)
    const latencySummary = this.#buildLatencySummary(costEvents)
    const retrySummary = this.#buildRetrySummary(stageEvents)
    const cacheCutSummary = this.#buildCacheCutSummary(costEvents)
    const modelBreakdown = this.#buildModelBreakdown(costEvents)
    const errorBreakdown = this.#buildErrorBreakdown(costEvents)

    // ── 预算状态 ──
    let budgetStatus: string | undefined
    const budgetWarnings: string[] = []
    if (budgetDecisions.length > 0) {
      // 取最新决策
      const latest = budgetDecisions[budgetDecisions.length - 1]!
      budgetStatus = latest.status
      if (latest.status === 'soft_exceeded' || latest.status === 'hard_exceeded') {
        if (latest.reason) budgetWarnings.push(latest.reason)
      }
    }

    // ── 事件数量与总耗时 ──
    const totalEvents = stageEvents.length + costEvents.length + budgetDecisions.length
    const totalLlmCalls = costEvents.filter((e) =>
      e.provider !== 'deterministic' && e.errorCategory !== 'none' ? true : e.totalTokens > 0,
    ).length
    const totalDurationMs = latencySummary.reduce((sum, item) => sum + item.totalMs, 0)

    // evidence refs
    const evidenceRefs: string[] = []
    for (const ce of costEvents) {
      if (ce.contextPacketRef) evidenceRefs.push(`artifact_ref:${ce.contextPacketRef}`)
      if (ce.modelOutputRef) evidenceRefs.push(`artifact_ref:${ce.modelOutputRef}`)
    }

    return {
      compilerRunId,
      stageId,
      budgetStatus: budgetStatus as any,
      budgetDecisions,
      budgetWarnings: budgetWarnings.length > 0 ? budgetWarnings : undefined,
      costSummary: costSummary.length > 0 ? costSummary : undefined,
      tokenSummary: tokenSummary.length > 0 ? tokenSummary : undefined,
      latencySummary: latencySummary.length > 0 ? latencySummary : undefined,
      retrySummary: retrySummary.length > 0 ? retrySummary : undefined,
      cacheCutSummary:
        cacheCutSummary.totalLlmCalls > 0 || cacheCutSummary.cacheHitCount > 0
          ? cacheCutSummary
          : undefined,
      modelBreakdown: modelBreakdown.length > 0 ? modelBreakdown : undefined,
      errorBreakdown: errorBreakdown.length > 0 ? errorBreakdown : undefined,
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
      aggregatedAt: new Date().toISOString(),
      totalEvents,
      totalLlmCalls,
      totalDurationMs,
    }
  }

  #buildCostSummary(costEvents: ModelCostEvent[]): CostSummaryItem[] {
    if (costEvents.length === 0) return []

    const total: CostSummaryItem = {
      dimension: 'total',
      label: '总成本',
      estimatedCost: 0,
      currency: 'CNY',
      callCount: costEvents.length,
      llmCallCount: 0,
      deterministicCallCount: 0,
    }

    const byStage = new Map<string, CostSummaryItem>()
    const byModel = new Map<string, CostSummaryItem>()

    for (const event of costEvents) {
      const cost = event.estimatedCost ?? 0
      total.estimatedCost += cost
      if (event.provider !== 'deterministic') total.llmCallCount++
      else total.deterministicCallCount++

      // by_stage
      const stageKey = event.stageId
      if (!byStage.has(stageKey)) {
        byStage.set(stageKey, {
          dimension: 'by_stage',
          label: stageKey,
          estimatedCost: 0,
          currency: event.currency ?? 'CNY',
          callCount: 0,
          llmCallCount: 0,
          deterministicCallCount: 0,
        })
      }
      const stageItem = byStage.get(stageKey)!
      stageItem.estimatedCost += cost
      stageItem.callCount++
      if (event.provider !== 'deterministic') stageItem.llmCallCount++
      else stageItem.deterministicCallCount++

      // by_model
      const modelKey = `${event.provider}/${event.model}`
      if (!byModel.has(modelKey)) {
        byModel.set(modelKey, {
          dimension: 'by_model',
          label: modelKey,
          estimatedCost: 0,
          currency: event.currency ?? 'CNY',
          callCount: 0,
          llmCallCount: 0,
          deterministicCallCount: 0,
        })
      }
      const modelItem = byModel.get(modelKey)!
      modelItem.estimatedCost += cost
      modelItem.callCount++
      if (event.provider !== 'deterministic') modelItem.llmCallCount++
      else modelItem.deterministicCallCount++
    }

    total.estimatedCost = Math.round(total.estimatedCost * 1_000_000) / 1_000_000
    for (const item of [...byStage.values(), ...byModel.values()]) {
      item.estimatedCost = Math.round(item.estimatedCost * 1_000_000) / 1_000_000
    }

    return [total, ...byStage.values(), ...byModel.values()]
  }

  #buildTokenSummary(costEvents: ModelCostEvent[]): TokenSummaryItem[] {
    if (costEvents.length === 0) return []

    const total: TokenSummaryItem = {
      dimension: 'total',
      label: '总 token',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    const byStage = new Map<string, TokenSummaryItem>()
    const byModel = new Map<string, TokenSummaryItem>()

    for (const event of costEvents) {
      total.promptTokens += event.promptTokens ?? 0
      total.completionTokens += event.completionTokens ?? 0
      total.totalTokens += event.totalTokens ?? 0

      const stageKey = event.stageId
      if (!byStage.has(stageKey)) {
        byStage.set(stageKey, {
          dimension: 'by_stage',
          label: stageKey,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        })
      }
      const s = byStage.get(stageKey)!
      s.promptTokens += event.promptTokens ?? 0
      s.completionTokens += event.completionTokens ?? 0
      s.totalTokens += event.totalTokens ?? 0

      const modelKey = `${event.provider}/${event.model}`
      if (!byModel.has(modelKey)) {
        byModel.set(modelKey, {
          dimension: 'by_model',
          label: modelKey,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        })
      }
      const m = byModel.get(modelKey)!
      m.promptTokens += event.promptTokens ?? 0
      m.completionTokens += event.completionTokens ?? 0
      m.totalTokens += event.totalTokens ?? 0
    }

    return [total, ...byStage.values(), ...byModel.values()]
  }

  #buildLatencySummary(costEvents: ModelCostEvent[]): LatencySummaryItem[] {
    if (costEvents.length === 0) return []

    const total: LatencySummaryItem = {
      dimension: 'total',
      label: '总延迟',
      totalMs: 0,
      avgMs: 0,
      maxMs: 0,
      minMs: Number.MAX_SAFE_INTEGER,
    }
    const byStage = new Map<string, LatencySummaryItem>()

    for (const event of costEvents) {
      const ms = event.latencyMs ?? 0
      total.totalMs += ms
      total.maxMs = Math.max(total.maxMs, ms)
      total.minMs = Math.min(total.minMs, ms)

      const stageKey = event.stageId
      if (!byStage.has(stageKey)) {
        byStage.set(stageKey, {
          dimension: 'by_stage',
          label: stageKey,
          totalMs: 0,
          avgMs: 0,
          maxMs: 0,
          minMs: Number.MAX_SAFE_INTEGER,
        })
      }
      const s = byStage.get(stageKey)!
      s.totalMs += ms
      s.maxMs = Math.max(s.maxMs, ms)
      s.minMs = Math.min(s.minMs, ms)
    }

    total.minMs = total.minMs === Number.MAX_SAFE_INTEGER ? 0 : total.minMs
    total.avgMs = costEvents.length > 0 ? Math.round(total.totalMs / costEvents.length) : 0
    for (const item of byStage.values()) {
      item.minMs = item.minMs === Number.MAX_SAFE_INTEGER ? 0 : item.minMs
      const count = costEvents.filter((e) => e.stageId === item.label).length
      item.avgMs = count > 0 ? Math.round(item.totalMs / count) : 0
    }

    return [total, ...byStage.values()]
  }

  #buildRetrySummary(stageEvents: any[]): RetrySummaryItem[] {
    if (stageEvents.length === 0) return []

    const byStage = new Map<string, { retry: number; firstSuccess: number; finalFailure: number }>()
    const stageAttempts = new Map<string, number>()

    for (const event of stageEvents) {
      const stageId = event.stageId
      const attemptNum = event.attemptNumber ?? 1
      const status = event.status

      if (!stageAttempts.has(stageId) || stageAttempts.get(stageId)! < attemptNum) {
        stageAttempts.set(stageId, attemptNum)
      }

      if (!byStage.has(stageId)) {
        byStage.set(stageId, { retry: 0, firstSuccess: 0, finalFailure: 0 })
      }

      const s = byStage.get(stageId)!
      if (status === 'failed') s.finalFailure++
    }

    // 计算总重试
    let totalRetry = 0
    let totalFirstSuccess = 0
    let totalFinalFailure = 0
    for (const [stageId, maxAttempt] of stageAttempts) {
      const info = byStage.get(stageId)!
      if (maxAttempt > 1) info.retry = maxAttempt - 1
      if (info.finalFailure === 0 && maxAttempt === 1) totalFirstSuccess++
      totalRetry += info.retry
      totalFinalFailure += info.finalFailure
    }

    return [
      {
        dimension: 'total',
        label: '总重试',
        retryCount: totalRetry,
        firstAttemptSuccessCount: totalFirstSuccess,
        finalFailureCount: totalFinalFailure,
      },
      ...Array.from(byStage.entries()).map(([stageId, info]) => ({
        dimension: 'by_stage' as const,
        label: stageId,
        retryCount: info.retry,
        firstAttemptSuccessCount: info.finalFailure === 0 ? 1 : 0,
        finalFailureCount: info.finalFailure,
      })),
    ]
  }

  #buildCacheCutSummary(costEvents: ModelCostEvent[]): CacheCutSummary & { totalLlmCalls: number } {
    let cacheHitCount = 0
    let cutCount = 0
    let cacheSavedTokens = 0
    let cutSavedTokens = 0

    for (const event of costEvents) {
      if (event.cacheHit) {
        cacheHitCount++
        cacheSavedTokens += event.promptTokens ?? 0
      }
      if (event.cacheCut) {
        cutCount++
        cutSavedTokens += (event.totalTokens ?? 0) * 0.5
      }
    }

    return {
      cacheHitCount,
      cacheMissCount: costEvents.length - cacheHitCount,
      cutCount,
      cacheSavedTokens,
      cutSavedTokens,
      totalLlmCalls: costEvents.length,
    }
  }

  #buildModelBreakdown(costEvents: ModelCostEvent[]): ModelBreakdownItem[] {
    const byModel = new Map<
      string,
      { callCount: number; estimatedCost: number; totalTokens: number; latencies: number[] }
    >()

    for (const event of costEvents) {
      const key = `${event.provider}/${event.model}`
      if (!byModel.has(key)) {
        byModel.set(key, { callCount: 0, estimatedCost: 0, totalTokens: 0, latencies: [] })
      }
      const m = byModel.get(key)!
      m.callCount++
      m.estimatedCost += event.estimatedCost ?? 0
      m.totalTokens += event.totalTokens ?? 0
      m.latencies.push(event.latencyMs ?? 0)
    }

    return Array.from(byModel.entries()).map(([key, m]) => ({
      provider: key.split('/')[0]!,
      model: key.split('/')[1]!,
      callCount: m.callCount,
      estimatedCost: Math.round(m.estimatedCost * 1_000_000) / 1_000_000,
      totalTokens: m.totalTokens,
      avgLatencyMs:
        m.latencies.length > 0
          ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
          : 0,
    }))
  }

  #buildErrorBreakdown(costEvents: ModelCostEvent[]): ErrorBreakdownItem[] {
    const byCategory = new Map<string, { count: number; lastOccurredAt?: string }>()

    for (const event of costEvents) {
      const cat = event.errorCategory ?? 'none'
      if (!byCategory.has(cat)) {
        byCategory.set(cat, { count: 0 })
      }
      const c = byCategory.get(cat)!
      c.count++
      c.lastOccurredAt = event.occurredAt ?? c.lastOccurredAt
    }

    return Array.from(byCategory.entries()).map(([category, info]) => ({
      errorCategory: category as any,
      count: info.count,
      lastOccurredAt: info.lastOccurredAt,
    }))
  }
}
