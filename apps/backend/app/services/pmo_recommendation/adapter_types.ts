/**
 * v3-pmo-ai-priority-recommendations — Source Adapter 类型定义。
 * Adapter 用于从各类 PMO 源数据中收集授权后的低敏候选输入。
 */

import type User from '#models/user'
import type {
  PmoRecommendationSource,
  PmoSourceSignal,
  PmoRecommendationWarning,
  PmoRecommendationCandidate,
} from '@aiproj/types'

/** Adapter 收集操作的上下文。 */
export interface PmoAdapterContext {
  organizationId: number
  actor: User
  /** 是否允许查看风险相关内容。 */
  hasRiskView: boolean
  /** 是否允许查看资源相关内容。 */
  hasResourceView: boolean
  /** 是否允许查看预测相关内容。 */
  hasPredictionView: boolean
  /** 是否允许查看健康诊断相关内容。 */
  hasHealthView: boolean
  /** 优先级评分是否可用（fixture 模式标记）。 */
  priorityScoringAvailable: boolean
  /** 交通灯是否可用。 */
  trafficLightAvailable: boolean
}

/** 单个 Adapter 的收集结果（区别于聚合结果 PmoCollectResult）。 */
export interface PmoAdapterCollectResult {
  candidates: PmoRecommendationCandidate[]
  signals: PmoSourceSignal[]
  warnings: PmoRecommendationWarning[]
  available: boolean
}

/** 单个 PMO Source Adapter 接口。 */
export interface PmoSourceAdapter {
  readonly sourceType: PmoRecommendationSource

  /**
   * 从授权源收集候选输入。
   * 不可用时返回带有 unavailable warning 的空结果。
   * 权限受限时排除受限数据，仅返回低敏摘要。
   */
  collect(ctx: PmoAdapterContext): Promise<PmoAdapterCollectResult>
}

/** 收集全部源的聚合结果。 */
export interface PmoCollectResult {
  candidates: PmoRecommendationCandidate[]
  signals: PmoSourceSignal[]
  warnings: PmoRecommendationWarning[]
  sourcesAvailable: number
  sourcesTotal: number
}
