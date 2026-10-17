/**
 * v3-copilot-feedback-driven-ranking — 加权排序服务
 *
 * 核心设计纪律：
 * - 严重度仍是第一排序键，加权只在同严重度内重排
 * - 位次移动不超过声明上限（WEIGHT_BOUNDS.maxPositionShift）
 * - 降权只改位次、不移出列表
 * - 默认关闭时完全不读加权投影
 * - 加权输入是账本的冻结投影，不是实时查询
 *
 * 纯确定性排序函数，零模型调用、零域写依赖。
 */

import type { InboxEntry, InboxSeverity } from '@aiproj/types'
import { inboxSeverityScore, sortInboxEntries } from '@aiproj/types'
import type {
  FeedbackWeightedProjection,
  FeedbackSortExplanation,
  FeedbackWeightedSortResult,
} from '@aiproj/types/copilot-feedback-ranking'
import { WEIGHT_BOUNDS } from '@aiproj/types/copilot-feedback-ranking'

/**
 * 严重度排序键顺序（降序）。
 */
const SEVERITY_ORDER: InboxSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

/**
 * 对同严重度条目应用有界加权重排。
 * 原始相对顺序作为基准，加权只能在移动上限内调整位次。
 *
 * 算法：
 * 1. 每个条目计算目标位次 = 原始位次 + clamp(weight, -maxShift, +maxShift)
 * 2. 按目标位次排序（相同目标位次保持原始相对顺序）
 * 3. 结果仍需满足：条目集合不变
 */
function boundedReorder<T extends { weight: number }>(
  items: T[],
  maxShift: number = WEIGHT_BOUNDS.maxPositionShift,
): T[] {
  if (items.length <= 1) return [...items]

  // 每个条目计算目标位次
  const indexed = items.map((item, originalIdx) => ({
    item,
    originalIdx,
    targetIdx: Math.max(
      0,
      Math.min(items.length - 1, originalIdx - clamp(item.weight, -maxShift, maxShift)),
    ),
  }))

  // 按目标位次排序，相同目标位次保持原始相对顺序
  indexed.sort((a, b) => {
    if (a.targetIdx !== b.targetIdx) return a.targetIdx - b.targetIdx
    return a.originalIdx - b.originalIdx
  })

  return indexed.map((x) => x.item)
}

/**
 * 截断到范围内。
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// §3.1 分层排序键
// ---------------------------------------------------------------------------

/**
 * 排序键分层：严重度 → 加权 → recency → 稳定破平局。
 * 严重度永远是第一排序键，加权只在同严重度内重排。
 */
export function layeredSort(
  entries: readonly InboxEntry[],
  projections: readonly FeedbackWeightedProjection[] = [],
): FeedbackWeightedSortResult {
  if (projections.length === 0) {
    // 无投影 → 使用既有确定性排序
    const sorted = sortInboxEntries(entries)
    return {
      entries: sorted,
      projectionVersion: 'none',
      explanations: [],
    }
  }

  // 按严重度分组，保留原始相对顺序
  const severityBuckets = new Map<string, (InboxEntry & { weight: number })[]>()

  for (const entry of entries) {
    const bucket = severityBuckets.get(entry.severity) ?? []
    const projection = projections.find((p) => p.problemKind === entry.problemKind)
    bucket.push({
      ...entry,
      weight: projection?.weight ?? 0,
    })
    severityBuckets.set(entry.severity, bucket)
  }

  // 按严重度降序遍历桶
  const sortedEntries: (InboxEntry & { weight: number })[] = []
  for (const severity of SEVERITY_ORDER) {
    const bucket = severityBuckets.get(severity)
    if (!bucket) continue
    // 在每个严重度桶内应用有界重排
    const reordered = boundedReorder(bucket)
    sortedEntries.push(...reordered)
  }

  // 计算解释
  const explanations: FeedbackSortExplanation[] = []
  for (const [i, entry] of sortedEntries.entries()) {
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

// ---------------------------------------------------------------------------
// §3.2 验证无跨严重度移动
// ---------------------------------------------------------------------------

export function validateNoCrossSeverityMovement(
  _original: readonly InboxEntry[],
  sorted: readonly InboxEntry[],
): boolean {
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]
    for (let j = 0; j < i; j++) {
      const before = sorted[j]
      if (inboxSeverityScore(before.severity) < inboxSeverityScore(entry.severity)) {
        return false
      }
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// §3.5 验证位次移动上限
// ---------------------------------------------------------------------------

export function validatePositionMovementBounded(
  original: readonly InboxEntry[],
  sorted: readonly InboxEntry[],
  maxShift: number = WEIGHT_BOUNDS.maxPositionShift,
): boolean {
  for (const [i, entry] of sorted.entries()) {
    const originalIndex = original.findIndex((e) => e.id === entry.id)
    if (originalIndex === -1) continue
    const shift = Math.abs(i - originalIndex)
    if (shift > maxShift) {
      return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// §3.7 验证条目集合不变
// ---------------------------------------------------------------------------

export function validateEntrySetUnchanged(
  original: readonly InboxEntry[],
  sorted: readonly InboxEntry[],
): boolean {
  if (original.length !== sorted.length) return false
  const originalIds = new Set(original.map((e) => e.id))
  return sorted.every((e) => originalIds.has(e.id))
}

// ---------------------------------------------------------------------------
// §4.3–4.4 可复现性
// ---------------------------------------------------------------------------

export function verifyDeterministicSort(
  entries: readonly InboxEntry[],
  projections: readonly FeedbackWeightedProjection[],
): boolean {
  const result1 = layeredSort(entries, projections)
  const result2 = layeredSort(entries, projections)
  return (
    result1.entries.length === result2.entries.length &&
    result1.entries.every((e, i) => e.id === result2.entries[i].id)
  )
}

export function simulateConcurrentSort(
  entries: readonly InboxEntry[],
  projections: readonly FeedbackWeightedProjection[],
  requestCount: number = 2,
): boolean {
  const results = Array.from({ length: requestCount }, () => layeredSort(entries, projections))
  return results.every(
    (r) =>
      r.entries.length === results[0].entries.length &&
      r.entries.every((e, i) => e.id === results[0].entries[i].id),
  )
}
