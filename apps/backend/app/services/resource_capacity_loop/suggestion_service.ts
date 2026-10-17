// v3-resource-capacity-forecasting-closed-loop —— 调配建议服务（任务 5.5）。
//
// 规则：
// - 以 unmet gap bucket 查询既有候选来源（reader 注入，生产接既有
//   CrossProjectAllocationService.listCandidates / skill-matrix candidates）；
// - 只消费权威排序结果（provenance/原分数原样保留），零重排零新总分；
// - 输出恒 advisoryOnly/applied=false/confirmationRequired。

import {
  projectAllocationSuggestion,
  type CandidateInput,
  type SuggestionProjectionOutput,
} from '@aiproj/types/resource-capacity-closed-loop-pure'
import type { ResourceCapacityLoopCanonicalPacket } from '@aiproj/types/resource-capacity-closed-loop'

export interface SuggestionQueryContext {
  /** 允许展示的候选 ref 白名单——隐藏候选由上游候选服务按权限过滤后仍可能标记 hidden。 */
  visibleCandidateRefIds?: readonly string[]
}

export default class ResourceCapacitySuggestionService {
  constructor(
    private candidateReader: (args: {
      dimension: 'role' | 'skill'
      dimensionKey: string
      buckets: string[]
    }) => Promise<CandidateInput[]>,
  ) {}

  async suggestForUnmetDimension(
    packet: ResourceCapacityLoopCanonicalPacket,
    dimension: 'role' | 'skill',
    dimensionKey: string,
    queryCtx: SuggestionQueryContext = {},
  ): Promise<SuggestionProjectionOutput> {
    const key = dimensionKey.trim().replace(/\s+/g, ' ').toLowerCase()
    const buckets = packet.facts
      .filter((f) => f.dimension === dimension && f.dimensionKey === key && f.gapHours > 0)
      .map((f) => f.bucket)

    const raw = await this.candidateReader({ dimension, dimensionKey: key, buckets })
    // 上游白名单外的候选一律标记 hidden（不泄露存在性）。
    const allowed = queryCtx.visibleCandidateRefIds
      ? new Set(queryCtx.visibleCandidateRefIds)
      : null
    const normalized = raw.map((c) => ({
      ...c,
      hidden: c.hidden || (allowed !== null && !allowed.has(c.candidateRefId)),
    }))

    const result = projectAllocationSuggestion(packet, dimension, key, normalized)
    if (!result.ok) {
      // 无缺口/超界属于调用方误用：显式抛错而非静默空建议。
      throw new Error(`suggestion 投影失败：${result.reasonCode} ${result.detail ?? ''}`)
    }
    return result.value
  }
}
