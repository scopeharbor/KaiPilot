/**
 * v3-ocr-provider-observability-cost-controls §4.1 — OCR provider 成本估算器。
 *
 * 将 provider usage + 目录定价快照映射为成本摘要。
 * 不做发明 token 数、不做假价格、不把未知当零。
 */

import type { OcrProviderUsageSummary, OcrCostEstimate, OcrPricingSnapshot } from '@aiproj/types'
import { estimateOcrCost, estimateOcrCostFallback } from '@aiproj/types'

export interface OcrProviderCostEstimatorOptions {
  /** 手动回退价格（仅 pricing snapshot 缺失时使用），单位：每 1k token。 */
  fallbackInputPrice?: number
  fallbackOutputPrice?: number
  fallbackCurrency?: string
}

export default class OcrProviderCostEstimator {
  readonly #fallbackInputPrice: number | null
  readonly #fallbackOutputPrice: number | null
  readonly #fallbackCurrency: string

  constructor(options?: OcrProviderCostEstimatorOptions) {
    this.#fallbackInputPrice = options?.fallbackInputPrice ?? null
    this.#fallbackOutputPrice = options?.fallbackOutputPrice ?? null
    this.#fallbackCurrency = options?.fallbackCurrency ?? 'USD'
  }

  /**
   * 从 usage + pricing snapshot 计算成本。
   * pricingSnapshotId 来自 AiConnectionModel.pricingSnapshotId（由 resolver 传入）。
   */
  estimate(
    usage: OcrProviderUsageSummary | null | undefined,
    pricingSnapshot: OcrPricingSnapshot | null | undefined,
    pricingSnapshotId?: string | null,
  ): OcrCostEstimate {
    if (pricingSnapshot) {
      return estimateOcrCost(usage, pricingSnapshot, pricingSnapshotId)
    }

    // 回退到手动配置
    if (
      typeof this.#fallbackInputPrice === 'number' &&
      typeof this.#fallbackOutputPrice === 'number' &&
      usage &&
      (usage.inputTokens || usage.outputTokens)
    ) {
      return estimateOcrCostFallback(
        usage,
        this.#fallbackInputPrice,
        this.#fallbackOutputPrice,
        this.#fallbackCurrency,
      )
    }

    // 完全无法估计
    return {
      estimatedCost: 0,
      currency: this.#fallbackCurrency,
      costStatus: 'cost_unknown',
      pricingSnapshotId: pricingSnapshotId ?? null,
      estimationBasis: 'no_pricing_data',
    }
  }
}
