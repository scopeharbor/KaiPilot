/**
 * v2-ai-smart-recommendations — 推荐 Source Adapter 类型定义。
 *
 * adapter_types.ts: RecommendationSourceAdapter 接口、CollectorParams、CollectorWarning。
 *
 * §3 — Source Adapter 契约。每个 Adapter 实现 collect()，返回推荐候选列表。
 */

import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 收集器参数
// ---------------------------------------------------------------------------

export interface CollectorParams {
  organizationId: number
  projectId: number
  userId: number
  hasRiskView: boolean
  hasResourceView: boolean
  hasChangeImpactView: boolean
}

// ---------------------------------------------------------------------------
// 收集器 Warning
// ---------------------------------------------------------------------------

export interface CollectorWarning {
  code: string
  message: string
  blocking?: boolean
  source?: RecommendationSource
}

// ---------------------------------------------------------------------------
// Source Adapter 接口
// ---------------------------------------------------------------------------

export interface RecommendationSourceAdapter {
  /**
   * 从来源收集推荐候选。
   * 返回候选列表，以及该来源的收集警告（例如权限不足、来源不可用）。
   */
  collect(params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }>
}
