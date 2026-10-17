/**
 * v2-ai-smart-recommendations — SourceUnavailableAdapter。
 *
 * 为尚未实现的来源（health_diagnosis、prediction、weekly_report、monthly_report）
 * 提供 stub 实现。始终返回 SOURCE_UNAVAILABLE warning，不返回任何候选。
 *
 * §3.6 — 来源不可用 Adapter。
 */

import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'
import type {
  CollectorParams,
  CollectorWarning,
  RecommendationSourceAdapter,
} from './adapter_types.js'

export default class SourceUnavailableAdapter implements RecommendationSourceAdapter {
  readonly source: RecommendationSource

  constructor(source: RecommendationSource) {
    this.source = source
  }

  async collect(_params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }> {
    return {
      candidates: [],
      warnings: [
        {
          code: 'SOURCE_UNAVAILABLE',
          message: `"${this.source}" 来源暂不可用，对应推荐功能未实现`,
          blocking: true,
          source: this.source,
        },
      ],
    }
  }
}
