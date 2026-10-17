/**
 * @aiproj/backend —— CompilerCostRecorder（tasks 2.2, 2.3）。
 *
 * 记录每次经 AIGateway 发起的 LLM/hybrid Stage 调用的成本事件。
 *
 * 职责：
 * 1. Provider/model/mode 记录
 * 2. Token 消耗、延迟、估算成本
 * 3. ContextPacketRef / ModelOutputRef 关联
 * 4. Error 分类（空输出、截断、provider 错误、schema 失败）
 * 5. 幂等键（idempotencyKey）去重
 * 6. 确定性 Stage 零成本断言
 *
 * @aiproj/backend
 */

import type { ModelCostEvent, FinishReason, ErrorCategory } from '@aiproj/compiler-spec'
import type { CompilerObservabilityRecorder } from './observability_recorder.js'
import { generateIdempotencyKey } from '@aiproj/compiler-spec'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import type { AiModelContextLimitSnapshot, AiModelUsageTokenSnapshot } from '@aiproj/types'
import { estimateAiModelCatalogCost } from '@aiproj/types'

export interface CostRecordingContext {
  compilerRunId: number
  organizationId: number
  stageId: string
  attemptNumber: number
  entityId?: string
  provider: string
  model: string
  modelMode?: 'thinking' | 'non-thinking'
  connectionId?: number | null
  connectionModelId?: number | null
  catalogProviderId?: string | null
  catalogModelId?: string | null
  pricingSnapshotId?: string | null
  contextLimits?: AiModelContextLimitSnapshot | null
  isReal: boolean
}

export interface CostCallRecord {
  /** 输入 token 数。 */
  promptTokens: number
  /** 输出 token 数。 */
  completionTokens: number
  /** 总 token 数。 */
  totalTokens: number
  /** 延迟（毫秒）。 */
  latencyMs: number
  /** 结束原因。 */
  finishReason?: FinishReason
  /** 错误分类。 */
  errorCategory?: ErrorCategory
  /** 错误消息摘要。 */
  errorMessage?: string
  /** 上下文 artifact ref。 */
  contextPacketRef?: string
  /** 模型输出 artifact ref。 */
  modelOutputRef?: string
  /** 是否缓存命中。 */
  cacheHit?: boolean
  /** 裁剪标记。 */
  cacheCut?: boolean
  cacheReadTokens?: number
  cacheWriteTokens?: number
  inputAudioTokens?: number
  outputAudioTokens?: number
  reasoningTokens?: number
  contextOver200kTokens?: number
}

/**
 * 默认单价（CNY / 1M tokens）。用于估算成本。
 * 实际应用应从配置或数据库读取。
 */
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.5, output: 2.0 },
  'deepseek-reasoner': { input: 1.0, output: 4.0 },
  'gpt-4o': { input: 10.0, output: 30.0 },
  'gpt-4o-mini': { input: 0.5, output: 1.5 },
  'mock-model': { input: 0, output: 0 },
}

/**
 * CompilerCostRecorder —— 模型调用成本记录器。
 *
 * 每次 AIGateway 调用包装处创建一次记录。
 * 确定性 Stage 禁止使用（应调用 recordDeterministicZeroCost 断言）。
 */
export class CompilerCostRecorder {
  readonly #recorder: CompilerObservabilityRecorder
  readonly #pricing: Record<string, { input: number; output: number }>
  readonly #catalog = new AiModelCatalogService()

  constructor(
    recorder: CompilerObservabilityRecorder,
    pricingOverrides?: Record<string, { input: number; output: number }>,
  ) {
    this.#recorder = recorder
    this.#pricing = { ...DEFAULT_PRICING, ...pricingOverrides }
  }

  /**
   * 记录一次 LLM/hybrid Stage 模型调用的成本事件。
   *
   * @param ctx - 调用上下文（runId, orgId, stageId, provider, model…）
   * @param call - 调用结果（token, latency, refs…）
   * @returns artifact ref 字符串
   */
  async recordCall(ctx: CostRecordingContext, call: CostCallRecord): Promise<string> {
    const idempotencyKey = generateIdempotencyKey('cost_write', {
      compilerRunId: ctx.compilerRunId,
      stageId: ctx.stageId,
      contractVersion: 1,
      manifestVersion: 1,
      attemptNumber: ctx.attemptNumber,
    })

    const usageSnapshot: AiModelUsageTokenSnapshot = {
      inputTokens: call.promptTokens,
      outputTokens: call.completionTokens,
      totalTokens: call.totalTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      inputAudioTokens: call.inputAudioTokens,
      outputAudioTokens: call.outputAudioTokens,
      reasoningTokens: call.reasoningTokens,
      contextOver200kTokens: call.contextOver200kTokens,
    }
    const catalogPricing = await this.#getCatalogPricing(ctx.pricingSnapshotId)
    const pricingKey = ctx.provider === 'deepseek' ? ctx.model : `${ctx.provider}/${ctx.model}`
    const legacyPricing = this.#getPricing(pricingKey)
    const estimate = catalogPricing
      ? estimateAiModelCatalogCost({
          usage: usageSnapshot,
          cost: catalogPricing.cost,
          currency: catalogPricing.currency,
        })
      : null
    const estimatedCost =
      estimate?.estimatedCost ??
      (legacyPricing
        ? this.#estimateCost(call.promptTokens, call.completionTokens, legacyPricing)
        : 0)
    const costEstimateStatus = estimate
      ? estimate.hasUnknownComponent
        ? 'partial_unknown'
        : 'priced'
      : legacyPricing
        ? 'legacy'
        : 'unknown'

    const costEvent: ModelCostEvent = {
      organizationId: ctx.organizationId,
      compilerRunId: ctx.compilerRunId,
      provider: ctx.provider,
      model: ctx.model,
      modelMode: ctx.modelMode,
      stageId: ctx.stageId,
      entityId: ctx.entityId,
      attemptNumber: ctx.attemptNumber,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      totalTokens: call.totalTokens,
      estimatedCost,
      costEstimateStatus,
      currency: estimate?.currency ?? 'CNY',
      pricingUnit: '1M_tokens',
      pricingSnapshotId: catalogPricing
        ? String(catalogPricing.id)
        : (ctx.pricingSnapshotId ?? undefined),
      catalogProviderId: ctx.catalogProviderId ?? undefined,
      catalogModelId: ctx.catalogModelId ?? undefined,
      usageSnapshot,
      contextLimitSnapshot: ctx.contextLimits ?? undefined,
      costComponents: estimate?.components,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      inputAudioTokens: call.inputAudioTokens,
      outputAudioTokens: call.outputAudioTokens,
      reasoningTokens: call.reasoningTokens,
      latencyMs: call.latencyMs,
      contextPacketRef: call.contextPacketRef,
      modelOutputRef: call.modelOutputRef,
      cacheHit: call.cacheHit ?? false,
      cacheCut: call.cacheCut ?? false,
      finishReason: call.finishReason,
      errorCategory: call.errorCategory ?? 'none',
      idempotencyKey,
      isReal: ctx.isReal,
      occurredAt: new Date().toISOString(),
    }

    const ref = await this.#recorder.recordCostEvent(costEvent)
    await this.#recordUsageSafe({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId ?? null,
      connectionModelId: ctx.connectionModelId ?? null,
      provider: ctx.provider,
      model: ctx.model,
      catalogProviderId: ctx.catalogProviderId ?? null,
      catalogModelId: ctx.catalogModelId ?? null,
      pricingSnapshotId: costEvent.pricingSnapshotId ?? null,
      usage: usageSnapshot,
      contextLimits: ctx.contextLimits ?? null,
      latencyMs: call.latencyMs,
      errorCategory: call.errorCategory ?? 'none',
    })
    return ref
  }

  /**
   * 记录确定性 Stage 零模型调用摘要。
   * 禁止产生非零 ModelCostEvent。
   */
  async recordDeterministicZeroCost(params: {
    compilerRunId: number
    organizationId: number
    stageId: string
    attemptNumber: number
  }): Promise<void> {
    // deterministic stages: always zero
    const costEvent: ModelCostEvent = {
      organizationId: params.organizationId,
      compilerRunId: params.compilerRunId,
      provider: 'deterministic',
      model: 'none',
      stageId: params.stageId,
      attemptNumber: params.attemptNumber,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      costEstimateStatus: 'priced',
      currency: 'CNY',
      latencyMs: 0,
      cacheHit: false,
      cacheCut: false,
      errorCategory: 'none',
      idempotencyKey: generateIdempotencyKey('cost_write', {
        compilerRunId: params.compilerRunId,
        stageId: params.stageId,
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: params.attemptNumber,
      }),
      isReal: false,
      occurredAt: new Date().toISOString(),
    }

    await this.#recorder.recordCostEvent(costEvent)
  }

  /**
   * 估算成本（CNY）。
   * 实际应用中应从配置数据库读取单价快照。
   */
  #estimateCost(
    promptTokens: number,
    completionTokens: number,
    pricing: { input: number; output: number } | null,
  ): number {
    if (!pricing) return 0
    const inputCost = (promptTokens / 1_000_000) * pricing.input
    const outputCost = (completionTokens / 1_000_000) * pricing.output
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
  }

  #getPricing(modelOrProvider: string): { input: number; output: number } | null {
    return this.#pricing[modelOrProvider] ?? null
  }

  async #getCatalogPricing(
    pricingSnapshotId: string | null | undefined,
  ): Promise<AiModelPricingSnapshot | null> {
    const id = Number(pricingSnapshotId)
    if (!Number.isFinite(id) || id <= 0) return null
    return AiModelPricingSnapshot.find(id)
  }

  async #recordUsageSafe(input: Parameters<AiModelCatalogService['recordUsageSnapshot']>[0]) {
    try {
      await this.#catalog.recordUsageSnapshot(input)
    } catch {
      // Cost artifact remains the source of truth when usage snapshot persistence is unavailable.
    }
  }
}
