/**
 * v2-ai-smart-recommendations — AdapterRegistry。
 *
 * 注册与获取所有 RecommendationSourceAdapter。
 * 缺失 adapter 返回 null（不抛异常），调用方自行降级。
 *
 * §3 — Source Adapter 注册中心。
 */

import type { RecommendationSource } from '@aiproj/types'
import type { RecommendationSourceAdapter } from './adapter_types.js'

export default class AdapterRegistry {
  /** 来源 → Adapter 映射表 */
  readonly #adapters = new Map<RecommendationSource, RecommendationSourceAdapter>()

  /**
   * 注册一个来源的 adapter。
   * 若同一来源已注册，后注册的覆盖前者。
   */
  register(source: RecommendationSource, adapter: RecommendationSourceAdapter): void {
    this.#adapters.set(source, adapter)
  }

  /**
   * 获取指定来源的 adapter。
   * 未注册时返回 null（不抛异常）。
   */
  getAdapter(source: RecommendationSource): RecommendationSourceAdapter | null {
    return this.#adapters.get(source) ?? null
  }

  /** 返回所有注册的 adapter（只读快照）。 */
  getAllAdapters(): Map<RecommendationSource, RecommendationSourceAdapter> {
    return new Map(this.#adapters)
  }

  /** 返回已注册的来源列表。 */
  getAvailableSources(): RecommendationSource[] {
    return Array.from(this.#adapters.keys())
  }
}
