/**
 * v2-ai-smart-recommendations — 推荐状态流转工具。
 *
 * §4.4 — 状态流转校验。
 */

import type { RecommendationStatus } from '@aiproj/types'
import { RECOMMENDATION_TRANSITIONS } from '@aiproj/types'

/**
 * 校验状态流转是否合法。
 * 如果流转非法，抛出 Error（业务层捕获后转化为 RECOMMENDATION_INVALID_TRANSITION）。
 */
export function assertTransition(from: RecommendationStatus, to: RecommendationStatus): void {
  if (from === to) return // 相同状态视为合法（幂等）
  const allowed = RECOMMENDATION_TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`RECOMMENDATION_INVALID_TRANSITION: 状态无法从 ${from} 流转到 ${to}`)
  }
}

/**
 * 获取某个状态的合法目标状态列表。
 */
export function getValidTransitions(from: RecommendationStatus): RecommendationStatus[] {
  return RECOMMENDATION_TRANSITIONS[from] ?? []
}
