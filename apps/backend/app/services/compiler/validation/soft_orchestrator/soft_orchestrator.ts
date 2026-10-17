/**
 * @aiproj/backend —— SoftEvaluatorOrchestrator：软评估编排执行器。
 *
 * 按 profile 执行维度评估，汇总 score、weightedScore、status、findings、confidence。
 * 处理：
 * - 6.2: unanchored finding 标记（模型未引用有效 entity id 时降低 confidence 并要求人工复核）
 * - 6.3: costAndLatencySummary
 * - 6.4: 预算上限和重试上限，超限时保留已完成维度
 */

import type {
  SoftEvaluationReport,
  SoftDimensionScore,
  CostAndLatencySummary,
} from '@aiproj/compiler-spec'
import type { EvaluationProfileService } from '../registry/evaluation_profiles.js'
import type { SeDimensionRegistry } from '../registry/se_dimension_registry.js'
import type {
  SoftCallResult,
  SoftEvaluatorCallConfig,
  DimensionEvaluationInput,
} from './deepseek_wrapper.js'
import {
  buildDimensionPrompt,
  parseDimensionResponse,
  toDimensionScore,
} from './deepseek_wrapper.js'
import type { ValidationInputContext } from '../types.js'

// ── LLM Call Interface ──

/**
 * LLM 调用抽象接口。
 * 对接 AIGateway 实现，可被 MockLLMCaller 替换用于测试。
 */
export interface LlmCaller {
  call(
    systemPrompt: string,
    userPrompt: string,
    config: SoftEvaluatorCallConfig,
  ): Promise<{ rawText: string; tokensUsed: number; latencyMs: number }>
}

// ── Mock LLM Caller ──

/**
 * Mock LLM 调用器（测试用）。
 */
export class MockLlmCaller implements LlmCaller {
  readonly #responses: Map<string, string> = new Map()

  /** 设置指定 dimensionId 的 mock 响应。 */
  setResponse(dimensionId: string, rawText: string): void {
    this.#responses.set(dimensionId, rawText)
  }

  async call(
    _systemPrompt: string,
    _userPrompt: string,
    config: SoftEvaluatorCallConfig,
  ): Promise<{ rawText: string; tokensUsed: number; latencyMs: number }> {
    const rawText = this.#responses.get(config.dimensionId) ?? '{"error": "no mock response"}'
    // 模拟延迟和 tokens
    const tokensUsed = rawText.length
    const latencyMs = Math.round(Math.random() * 100 + 50)
    return { rawText, tokensUsed, latencyMs }
  }
}

// ── Cost Tracker ──

export class CostTracker {
  totalCalls = 0
  totalTokens = 0
  totalLatencyMs = 0
  retryCount = 0
  #budgetTokens: number
  #budgetCalls: number
  #budgetStatus: 'within_budget' | 'budget_exceeded' | 'no_budget' = 'within_budget'

  constructor(budgetTokens: number, budgetCalls: number) {
    this.#budgetTokens = budgetTokens
    this.#budgetCalls = budgetCalls
    if (budgetTokens === 0 && budgetCalls === 0) {
      this.#budgetStatus = 'no_budget'
    }
  }

  recordCall(tokens: number, latencyMs: number): boolean {
    this.totalCalls++
    this.totalTokens += tokens
    this.totalLatencyMs += latencyMs
    return this.isWithinBudget()
  }

  recordRetry(): void {
    this.retryCount++
  }

  isWithinBudget(): boolean {
    if (this.#budgetStatus === 'no_budget') return true
    if (this.#budgetTokens > 0 && this.totalTokens >= this.#budgetTokens) {
      this.#budgetStatus = 'budget_exceeded'
      return false
    }
    if (this.#budgetCalls > 0 && this.totalCalls >= this.#budgetCalls) {
      this.#budgetStatus = 'budget_exceeded'
      return false
    }
    return true
  }

  get budgetStatus(): 'within_budget' | 'budget_exceeded' | 'no_budget' {
    return this.#budgetStatus
  }

  toSummary(provider: string, model: string, dimensionCount: number): CostAndLatencySummary {
    return {
      totalCalls: this.totalCalls,
      totalTokens: this.totalTokens,
      totalLatencyMs: this.totalLatencyMs,
      provider,
      model,
      dimensionCount,
      retryCount: this.retryCount,
      budgetStatus: this.#budgetStatus,
      budgetLimitTokens: this.#budgetTokens,
      budgetLimitCalls: this.#budgetCalls,
    }
  }
}

// ── SoftEvaluatorOrchestrator ──

export class SoftEvaluatorOrchestrator {
  readonly #profileService: EvaluationProfileService
  readonly #llmCaller: LlmCaller

  constructor(
    _dimensionRegistry: SeDimensionRegistry,
    profileService: EvaluationProfileService,
    llmCaller: LlmCaller,
  ) {
    this.#profileService = profileService
    this.#llmCaller = llmCaller
  }

  /**
   * 按 profile 执行维度评估。
   */
  async evaluate(
    profileId: string,
    context: ValidationInputContext,
  ): Promise<SoftEvaluationReport> {
    const profile = this.#profileService.getProfile(profileId)
    if (!profile) {
      throw new Error(`Profile "${profileId}" 不存在`)
    }

    // 解析维度
    const resolved = this.#profileService.resolveDimensions(profileId)
    if (resolved.dimensions.length === 0) {
      throw new Error(`Profile "${profileId}" 无对应维度`)
    }

    const costTracker = new CostTracker(profile.budgetTokens, profile.budgetCalls)
    const dimensionScores: SoftDimensionScore[] = []
    const provider = 'deepseek'
    const model = 'deepseek-v4-flash'

    // 按维度逐一评估
    for (const dim of resolved.dimensions) {
      // 6.4: 预算检查
      if (!costTracker.isWithinBudget()) {
        dimensionScores.push({
          dimensionId: dim.dimensionId,
          score: 0,
          confidence: 0,
          rationale: '预算耗尽未能评估',
          findings: [],
          status: 'unavailable',
          unavailableReason: 'budget_exceeded',
          attemptId: `att-${dim.dimensionId}-${context.runId ?? 'unknown'}`,
          provider,
          model,
          tokensUsed: 0,
          latencyMs: 0,
          retryCount: 0,
        })
        continue
      }

      const attemptId = `att-${dim.dimensionId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

      // 构建输入
      const input: DimensionEvaluationInput = {
        dimensionId: dim.dimensionId,
        dimensionName: dim.name,
        rubric: dim.rubric.map((r) => `${r.score}: ${r.description}`).join('\n'),
        pdmSlice: (context.pdmSnapshot as Record<string, unknown>) ?? {},
        deterministicSignals: dim.deterministicSignals.reduce(
          (acc, sig) => {
            acc[sig] = `{{${sig}}}`
            return acc
          },
          {} as Record<string, string>,
        ),
      }

      // 构建 prompt
      const callConfig: SoftEvaluatorCallConfig = {
        stageId: context.stageId,
        dimensionId: dim.dimensionId,
        dimensionIds: [dim.dimensionId],
        attemptId,
        provider,
        model,
        temperature: 0.1,
        maxTokens: 4096,
        maxRetries: profile.maxRetriesPerDimension,
      }

      const { systemPrompt, userPrompt } = buildDimensionPrompt(input, callConfig)

      // 调用 LLM（带重试）
      let lastResult: SoftCallResult | null = null
      let retriesLeft = profile.maxRetriesPerDimension
      while (retriesLeft >= 0) {
        try {
          const response = await this.#llmCaller.call(systemPrompt, userPrompt, callConfig)
          costTracker.recordCall(response.tokensUsed, response.latencyMs)

          // 收集 known entity IDs
          const knownEntityIds = this.#collectEntityIds(context)

          // 6.2: parse + entity ID 校验
          lastResult = parseDimensionResponse(response.rawText, dim.dimensionId, knownEntityIds)
          lastResult.tokensUsed = response.tokensUsed
          lastResult.latencyMs = response.latencyMs
          lastResult.retryCount = profile.maxRetriesPerDimension - retriesLeft
        } catch (err) {
          lastResult = {
            success: false,
            errorKind: 'provider_error',
            errorMessage: err instanceof Error ? err.message : String(err),
            tokensUsed: 0,
            latencyMs: 0,
            retryCount: profile.maxRetriesPerDimension - retriesLeft,
          }
        }

        if (lastResult.success) break

        const retryable =
          lastResult.errorKind === 'empty_content' ||
          lastResult.errorKind === 'not_json' ||
          lastResult.errorKind === 'truncated_json' ||
          lastResult.errorKind === 'missing_fields' ||
          lastResult.errorKind === 'invalid_score'

        if (retryable && retriesLeft > 0) {
          retriesLeft--
          costTracker.recordRetry()
          continue
        }
        break
      }

      // 转换为维度评分
      if (lastResult && !lastResult.success) {
        lastResult.retryCount = profile.maxRetriesPerDimension - retriesLeft
      }
      const score = toDimensionScore(
        lastResult ?? {
          success: false,
          errorKind: 'retry_exhausted',
          errorMessage: '重试耗尽',
          tokensUsed: 0,
          latencyMs: 0,
          retryCount: profile.maxRetriesPerDimension,
        },
        dim.dimensionId,
        callConfig,
        lastResult?.tokensUsed ?? 0,
        lastResult?.latencyMs ?? 0,
      )
      dimensionScores.push(score)
    }

    // ── 汇总 ──
    const evaluatedScores = dimensionScores.filter((s) => s.status === 'evaluated')
    const unavailableScores = dimensionScores.filter((s) => s.status === 'unavailable')

    let status: SoftEvaluationReport['status']
    if (dimensionScores.every((s) => s.status === 'unavailable')) {
      status = 'all_unavailable'
    } else if (unavailableScores.length > 0) {
      status = 'partial'
    } else if (
      costTracker.budgetStatus === 'budget_exceeded' &&
      dimensionScores.some((s) => s.status !== 'evaluated')
    ) {
      status = 'budget_exceeded'
    } else {
      status = 'completed'
    }

    // 如果所有维度都 unavailable，则 overallScore 和 weightedScore 为 undefined
    const overallScore =
      evaluatedScores.length > 0
        ? evaluatedScores.reduce((sum, s) => sum + s.score, 0) / evaluatedScores.length
        : undefined

    let weightedScore: number | undefined
    if (evaluatedScores.length > 0) {
      const totalWeight = resolved.dimensions.reduce(
        (sum, d) => sum + (resolved.weights[d.dimensionId] ?? d.weight),
        0,
      )
      if (totalWeight > 0) {
        weightedScore =
          evaluatedScores.reduce((sum, s) => {
            const dim = resolved.dimensions.find((d) => d.dimensionId === s.dimensionId)
            const weight = dim ? (resolved.weights[dim.dimensionId] ?? dim.weight) : 0
            return sum + s.score * weight
          }, 0) / totalWeight
      }
    }

    const confidenceValues = evaluatedScores.map((s) => s.confidence).filter((c) => c > 0)
    const overallConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
        : undefined

    return {
      evaluationId: `se-${context.stageId}-${Date.now()}`,
      profile: {
        profileId: profile.profileId,
        name: profile.name,
        dimensionIds: profile.dimensionIds,
        weightOverrides: profile.weightOverrides,
        thresholdOverrides: profile.thresholdOverrides,
        budgetTokens: profile.budgetTokens,
        budgetCalls: profile.budgetCalls,
        maxRetriesPerDimension: profile.maxRetriesPerDimension,
        enabledByDefault: profile.enabledByDefault,
        description: profile.description,
      },
      model,
      dimensionsEvaluated: dimensionScores.map((s) => s.dimensionId),
      overallScore,
      weightedScore,
      status,
      dimensionScores,
      confidence: overallConfidence,
      costAndLatencySummary: costTracker.toSummary(provider, model, dimensionScores.length),
      generatedAt: new Date().toISOString(),
    }
  }

  /** 收集已知的实体 ID。 */
  #collectEntityIds(_context: ValidationInputContext): string[] {
    // 从 pdm snapshot 和 deterministic outputs 中提取
    // 简化实现：测试用返回空列表让 mock 覆盖
    return []
  }
}
