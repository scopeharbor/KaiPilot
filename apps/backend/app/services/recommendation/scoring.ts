/**
 * v2-ai-smart-recommendations — 推荐确定性评分工具。
 *
 * §4.3 — 确定性 priority scoring。
 */

import type { RecommendationSeverity } from '@aiproj/types'
import { recommendationSeverityScore } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 影响范围评分
// ---------------------------------------------------------------------------

const IMPACT_SCOPE_SCORES: Record<string, number> = {
  project: 5,
  milestone: 4,
  task: 3,
  resource: 2,
  risk: 3,
}

// ---------------------------------------------------------------------------
// 置信度评分
// ---------------------------------------------------------------------------

const CONFIDENCE_SCORES: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

// ---------------------------------------------------------------------------
// 去重键生成
// ---------------------------------------------------------------------------

/**
 * 生成稳定 dedupeKey。
 * 用于合并同一项目、同一来源、同一目标对象和同类行动的重复候选。
 */
export function computeDedupeKey(
  source: string,
  sourceId: string,
  targetEntityType?: string,
  targetEntityId?: number | null,
): string {
  const targetPart =
    targetEntityType && targetEntityId !== null && targetEntityId !== undefined
      ? `-${targetEntityType}-${targetEntityId}`
      : ''
  return `${source}-${sourceId}${targetPart}`
}

// ---------------------------------------------------------------------------
// 输入签名
// ---------------------------------------------------------------------------

/**
 * 生成简化的 inputSignature（生产环境应使用 SHA-256）。
 */
export function computeInputSignature(candidate: {
  sourceType: string
  sourceId: string
  dedupeKey: string
  severity: string
  priority: number
  evidenceRefs?: Array<{ summaryHash?: string }>
}): string {
  const refHashes = (candidate.evidenceRefs || [])
    .map((r) => r.summaryHash || '')
    .sort()
    .join(',')
  const raw = `${candidate.sourceType}|${candidate.sourceId}|${candidate.dedupeKey}|${candidate.severity}|${candidate.priority}|${refHashes}`
  // 使用简单 hash 函数（生产环境应使用 crypto）
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// 证据 hash
// ---------------------------------------------------------------------------

/**
 * 生成 evidenceHash。
 */
export function computeEvidenceHash(
  evidenceRefs?: Array<{ summaryHash?: string; entityType?: string; entityId?: number }>,
): string {
  const parts = (evidenceRefs || [])
    .map((r) => `${r.entityType || ''}:${r.entityId || ''}:${r.summaryHash || ''}`)
    .sort()
    .join('|')
  let hash = 0
  for (let i = 0; i < parts.length; i++) {
    const char = parts.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(36).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// 优先级评分
// ---------------------------------------------------------------------------

/**
 * 计算确定性优先级评分。
 *
 * 评分因子：
 * - severity（严重度分数 * 20，权重最大）
 * - urgency（紧急度 1-10 * 2）
 * - impactScope（影响范围）
 * - confidence（置信度）
 *
 * 总分范围：约 27（最低）～ 136（最高）
 */
export function computePriority(candidate: {
  severity: RecommendationSeverity
  urgency: number
  impactScope: string
  confidence: string
}): number {
  const severityScore = recommendationSeverityScore(candidate.severity) // 1-5
  const urgencyScore = Math.max(1, Math.min(10, candidate.urgency))
  const impactScore = IMPACT_SCOPE_SCORES[candidate.impactScope] ?? 1
  const confidenceScore = CONFIDENCE_SCORES[candidate.confidence] ?? 1

  return severityScore * 20 + urgencyScore * 2 + impactScore + confidenceScore
}
