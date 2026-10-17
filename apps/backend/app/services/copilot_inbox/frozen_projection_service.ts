/**
 * v3-copilot-feedback-driven-ranking — 冻结投影服务
 *
 * 核心设计纪律：
 * - 加权输入是账本的冻结投影，不是实时查询
 * - 同一投影版本 + 同一条目集合 → 同一排序
 * - 投影按窗口重算，重算过程不影响正在进行的排序
 * - 投影版本号写进排序响应供复核
 *
 * 纯确定性投影函数，零模型调用、零域写依赖。
 */

import type {
  FeedbackWeightedProjection,
  FeedbackWeightedProjectionSnapshot,
} from '@aiproj/types/copilot-feedback-ranking'
import type { UnifiedFeedbackEvent } from '@aiproj/types'

// ---------------------------------------------------------------------------
// §4.1 冻结投影
// ---------------------------------------------------------------------------

/**
 * 从反馈事件列表生成冻结投影。
 * 按 (actorId, problemKind) 聚合拒绝计数和采纳计数。
 *
 * 红线：
 * - 不实时聚合（输入已经是聚合后的事件列表）
 * - 不读取可变状态
 * - 同一输入 → 同一输出（确定性）
 */
export function generateFrozenProjection(
  events: readonly UnifiedFeedbackEvent[],
  options: {
    organizationId: number
    projectionVersion: string
  },
): FeedbackWeightedProjection[] {
  // 按 (actorId, problemKind) 分组
  const groups = new Map<
    string,
    {
      actorId: number
      problemKind: string
      rejectionCount: number
      adoptionCount: number
    }
  >()

  for (const event of events) {
    // 只使用当前组织的事件
    if (event.organizationId !== options.organizationId) continue

    // 只使用当前 actor 的事件
    const key = `${event.actorId}:${event.artifactKind}`
    const group = groups.get(key) ?? {
      actorId: event.actorId,
      problemKind: event.artifactKind,
      rejectionCount: 0,
      adoptionCount: 0,
    }

    if (event.feedbackType === 'rejected') {
      group.rejectionCount++
    } else if (event.feedbackType === 'accepted' || event.feedbackType === 'modified') {
      group.adoptionCount++
    }

    groups.set(key, group)
  }

  // 生成投影
  const projections: FeedbackWeightedProjection[] = []
  for (const group of groups.values()) {
    const weight = computeProjectionWeight(group.rejectionCount)
    projections.push({
      actorId: group.actorId,
      organizationId: options.organizationId,
      problemKind: group.problemKind,
      rejectionCount: group.rejectionCount,
      adoptionCount: group.adoptionCount,
      weight,
      projectionVersion: options.projectionVersion,
    })
  }

  // 按 problemKind 排序（确定性）
  projections.sort((a, b) => a.problemKind.localeCompare(b.problemKind))

  return projections
}

/**
 * 从拒绝计数计算权重（有界）。
 */
function computeProjectionWeight(rejectionCount: number): number {
  const raw = -rejectionCount
  return Math.max(-3, Math.min(3, raw))
}

// ---------------------------------------------------------------------------
// §4.2 投影版本号
// ---------------------------------------------------------------------------

/**
 * 生成投影版本号。
 * 版本号包含时间戳和事件哈希，确保唯一性。
 */
export function generateProjectionVersion(events: readonly UnifiedFeedbackEvent[]): string {
  // 使用事件 ID 的哈希作为版本号的一部分
  const eventIds = events
    .map((e) => e.id)
    .sort()
    .join(',')
  const hash = simpleHash(eventIds)
  // 版本号仅由事件哈希决定（确定性，不含时间戳）
  return `proj-${hash}`
}

/**
 * 简单哈希函数（确定性）。
 */
function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

// ---------------------------------------------------------------------------
// §4.5 投影重算
// ---------------------------------------------------------------------------

/**
 * 投影缓存：存储冻结投影快照。
 * 重算时不影响正在进行的排序（读旧版本）。
 */
let cachedSnapshot: FeedbackWeightedProjectionSnapshot | null = null

/**
 * 获取当前冻结投影（读缓存，不实时计算）。
 */
export function getFrozenProjection(): FeedbackWeightedProjectionSnapshot | null {
  return cachedSnapshot
}

/**
 * 更新冻结投影（重算时原子替换）。
 * 旧版本在替换前仍可读取，直到新版本完全就绪。
 */
export function updateFrozenProjection(snapshot: FeedbackWeightedProjectionSnapshot): void {
  cachedSnapshot = snapshot
}

/**
 * 清除缓存（测试用）。
 */
export function clearProjectionCache(): void {
  cachedSnapshot = null
}
