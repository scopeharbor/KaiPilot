/**
 * v3-copilot-feedback-driven-ranking — 反馈加权排序共享契约
 *
 * 核心设计纪律：
 * - 加权只在同严重度内重排，严重度仍是第一排序键
 * - 默认关闭，组织级开启，个人可在其内更严格
 * - 加权输入是账本的冻结投影，不是实时查询
 * - 同一投影版本 + 同一条目集合 → 同一排序（确定性）
 * - 只用当前 actor 自己的反馈，不产生跨用户协同过滤
 * - 每个被移动的条目携带可读原因
 * - 降权只改位次、不移出列表
 * - 加权不使用模型、不写域数据
 *
 * 纯静态类型 + const 数组 + 确定性纯函数，零运行时/DB/网络依赖。
 */

import type { InboxSeverity, InboxEntry } from './copilot-suggestion-inbox.js'
import { inboxSeverityScore } from './copilot-suggestion-inbox.js'

// ===========================================================================
// §2.2 加权投影形状
// ===========================================================================

/**
 * 加权投影：按 (actorId, problemKind) 聚合的反馈计数。
 * 这是排序层的唯一输入来源，不含建议正文、prompt、模型输出、token 与 secret。
 */
export interface FeedbackWeightedProjection {
  /** 操作者 ID */
  readonly actorId: number
  /** 组织 ID（组织隔离） */
  readonly organizationId: number
  /** 问题种类（与 InboxEntry.problemKind 对应） */
  readonly problemKind: string
  /** 拒绝计数 */
  readonly rejectionCount: number
  /** 采纳计数 */
  readonly adoptionCount: number
  /** 加权值（由 rejectionCount 派生，有上下界） */
  readonly weight: number
  /** 投影版本号（冻结标识） */
  readonly projectionVersion: string
}

/**
 * 投影快照：多个加权投影条目组成的冻结集合。
 */
export interface FeedbackWeightedProjectionSnapshot {
  /** 投影版本号 */
  readonly version: string
  /** 投影生成时间（ISO 8601） */
  readonly generatedAt: string
  /** 投影条目列表 */
  readonly entries: readonly FeedbackWeightedProjection[]
}

// ===========================================================================
// §2.3 排序解释形状
// ===========================================================================

/**
 * 排序解释：描述单个条目为何被加权移动。
 */
export interface FeedbackSortExplanation {
  /** 条目 ID */
  readonly entryId: string
  /** 原位次（0-based） */
  readonly originalPosition: number
  /** 新位次（0-based） */
  readonly newPosition: number
  /** 移动原因（人类可读） */
  readonly reason: string
  /** 导致移动的拒绝计数 */
  readonly rejectionCount: number
}

/**
 * 排序结果：条目列表 + 投影版本 + 解释集合。
 */
export interface FeedbackWeightedSortResult {
  /** 排序后的条目列表 */
  readonly entries: readonly InboxEntry[]
  /** 使用的投影版本 */
  readonly projectionVersion: string
  /** 被移动的条目解释（未移动的条目不携带解释） */
  readonly explanations: readonly FeedbackSortExplanation[]
}

// ===========================================================================
// §2.4 权重上下界常量
// ===========================================================================

/**
 * 权重上下界：同严重度内最多移动的位次数。
 * 超出此范围的权重被截断到边界值。
 */
export const WEIGHT_BOUNDS = {
  /** 最大负权重（最多降多少位） */
  maxNegativeWeight: -3,
  /** 最大正权重（最多升多少位） */
  maxPositiveWeight: 3,
  /** 位次移动上限（绝对值） */
  maxPositionShift: 3,
} as const

/**
 * 严重度数值到分数的映射（与 inboxSeverityScore 一致）。
 */
export const SEVERITY_SCORES: Record<InboxSeverity, number> = {
  critical: 50,
  high: 40,
  medium: 30,
  low: 20,
  info: 10,
}

// ===========================================================================
// §2.5 禁存约束
// ===========================================================================

/**
 * 加权投影与解释中禁止出现的字段名。
 * 这些字段可能包含建议正文、prompt、模型输出、token 或 secret。
 */
export const RANKING_FORBIDDEN_FIELDS = [
  'suggestionBody',
  'suggestionText',
  'body',
  'content',
  'prompt',
  'systemPrompt',
  'modelOutput',
  'response',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'password',
  'credential',
] as const

/**
 * 校验加权投影或解释不含禁止字段。
 * 返回 true 表示合法（无禁止字段）。
 */
export function validateRankingNoStorageViolation(input: Record<string, unknown>): {
  valid: boolean
  violations: string[]
} {
  const violations: string[] = []
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const key of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if ((RANKING_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
        violations.push(fullKey)
      }
      const value = obj[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, fullKey)
      }
    }
  }
  walk(input, '')
  return { valid: violations.length === 0, violations }
}

// ===========================================================================
// §3 分层排序纯函数
// ===========================================================================

/**
 * 加权排序比较器：严重度 → 加权 → recency → 稳定破平局。
 * 加权只在同严重度内重排。
 */
export function compareWeightedEntries(
  a: InboxEntry & { weight?: number },
  b: InboxEntry & { weight?: number },
): number {
  // 1. 严重度降序（永远不能被加权跨越）
  const sevDiff = inboxSeverityScore(b.severity) - inboxSeverityScore(a.severity)
  if (sevDiff !== 0) return sevDiff

  // 2. 加权降序（同严重度内，权重越高越靠前）
  const weightA = a.weight ?? 0
  const weightB = b.weight ?? 0
  const weightDiff = weightB - weightA
  if (weightDiff !== 0) return weightDiff

  // 3. 创建时间降序
  const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  if (timeDiff !== 0) return timeDiff

  // 4. id 升序（稳定破平局）
  return a.id.localeCompare(b.id)
}

/**
 * 从拒绝计数计算权重（有界）。
 * 拒绝越多，权重越负（越靠后）。
 */
export function computeWeight(rejectionCount: number): number {
  // 简单线性映射：每拒绝 1 条减 1 权重，但截断到边界
  const raw = -rejectionCount
  return Math.max(WEIGHT_BOUNDS.maxNegativeWeight, Math.min(WEIGHT_BOUNDS.maxPositiveWeight, raw))
}

/**
 * 应用加权排序：只在同严重度内重排，不跨越严重度边界。
 * 返回新的排序结果 + 解释集合。
 */
export function applyWeightedSorting(
  entries: readonly InboxEntry[],
  projections: readonly FeedbackWeightedProjection[],
): FeedbackWeightedSortResult {
  // 按严重度分组
  const severityBuckets = new Map<string, (InboxEntry & { weight: number })[]>()

  for (const entry of entries) {
    const bucket = severityBuckets.get(entry.severity) ?? []
    // 查找该条目的加权投影
    const projection = projections.find((p) => p.problemKind === entry.problemKind)
    bucket.push({
      ...entry,
      weight: projection?.weight ?? 0,
    })
    severityBuckets.set(entry.severity, bucket)
  }

  // 在每个严重度桶内排序
  const sortedEntries: (InboxEntry & { weight: number })[] = []
  for (const bucket of severityBuckets.values()) {
    bucket.sort(compareWeightedEntries)
    sortedEntries.push(...bucket)
  }

  // 计算解释
  const explanations: FeedbackSortExplanation[] = []
  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i]
    if (!entry) continue
    // 查找原始位置
    const originalIndex = entries.findIndex((e) => e.id === entry.id)
    if (originalIndex !== i && entry.weight < 0) {
      explanations.push({
        entryId: entry.id,
        originalPosition: originalIndex,
        newPosition: i,
        reason: `因您此前拒绝过 ${-entry.weight} 条同类建议而降权`,
        rejectionCount: -entry.weight,
      })
    }
  }

  return {
    entries: sortedEntries,
    projectionVersion: projections[0]?.projectionVersion ?? 'none',
    explanations,
  }
}

// ===========================================================================
// §4 可复现性
// ===========================================================================

/**
 * 验证排序确定性：同一投影版本 + 同一条目集合 → 同一排序。
 */
export function verifyDeterministicSort(
  entries: readonly InboxEntry[],
  projections: readonly FeedbackWeightedProjection[],
): boolean {
  const result1 = applyWeightedSorting(entries, projections)
  const result2 = applyWeightedSorting(entries, projections)
  return (
    result1.entries.length === result2.entries.length &&
    result1.entries.every((e, i) => e.id === result2.entries[i]?.id)
  )
}
