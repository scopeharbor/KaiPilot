/**
 * v3-knowledge-memory-operating-layer —— 四个 read adapter 共享的投影 helper。
 *
 * 存在的理由：spec 要求「summary 与对应过滤后的队列 MUST 使用相同 visibility
 * 规则」。把 facet 匹配与状态计数收敛到一处，count 与 list 就不可能各自漂移；
 * 每个 adapter 只负责「取哪些行、怎么投影」。
 *
 * 这里只处理已经投影完成的低敏对象，不接触 Model、不发 SQL、不看正文。
 *
 * @aiproj/backend
 */

import { sortOperatingItems } from '@aiproj/types'
import type {
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryOperatingStatus,
} from '@aiproj/types'

import type { OperatingCountResult } from './port.js'

/**
 * 取本 lane 的合并窗口：**先按跨 lane 的规范排序，再截断**。
 *
 * 顺序不能反过来，也不能依赖 SQL 的 `ORDER BY updated_at`：跨 lane 的首要
 * 排序键是 attention priority，而它是内存派生的。若 lane 按自己的顺序截断，
 * 交出的就不是「全局最靠前的 N 项」，聚合器切片后相邻页会重复与遗漏——
 * 正是本 helper 要消除的那一类缺陷。
 */
export function takeOperatingWindow<T extends KnowledgeMemoryOperatingItem>(
  items: readonly T[],
  limit: number,
): readonly T[] {
  return sortOperatingItems(items).slice(0, Math.max(0, limit)) as unknown as readonly T[]
}

/** 全零的 facet 计数表（封闭 9 status 词表）。 */
export function emptyStatusCounts(): Record<KnowledgeMemoryOperatingStatus, number> {
  return {
    ready: 0,
    needs_review: 0,
    stale_or_unconfirmed: 0,
    conflict: 0,
    provenance_gap: 0,
    synthetic_eval_only: 0,
    retention_attention: 0,
    retrieval_gap: 0,
    degraded: 0,
  }
}

/**
 * 按 attention status 真实计数。
 *
 * 早期实现把 lane 总数整个塞进「第一个被请求的 status」，导致 summary 的
 * facet 数字是编造的；这里只统计实际派生出的 status。
 */
export function countByStatus(
  items: readonly KnowledgeMemoryOperatingItem[],
): Record<KnowledgeMemoryOperatingStatus, number> {
  const out = emptyStatusCounts()
  for (const it of items) {
    if (it.status in out) out[it.status] += 1
  }
  return out
}

/** count 与 list 共用的 facet predicate（空数组 = 不过滤）。 */
export function matchesOperatingFacets(
  item: KnowledgeMemoryOperatingItem,
  filters: {
    readonly statuses?: readonly KnowledgeMemoryOperatingStatus[]
    readonly scopes?: readonly KnowledgeMemoryOperatingScope[]
  },
): boolean {
  const { statuses, scopes } = filters
  if (statuses && statuses.length > 0 && !statuses.includes(item.status)) return false
  if (scopes && scopes.length > 0 && !scopes.includes(item.scope)) return false
  return true
}

/**
 * 由有界扫描结果拼 lane count 结果。
 *
 * `truncated` 为真时 coverage 必须是 `partial`——窗口被截断的总数不得
 * 冒充 `complete`，否则就是 spec 禁止的 false-ready。
 */
export function buildLaneCountResult(
  visible: readonly KnowledgeMemoryOperatingItem[],
  truncated: boolean,
): OperatingCountResult {
  return {
    total: visible.length,
    attentionCount: visible.filter((it) => it.status !== 'ready').length,
    statusCounts: countByStatus(visible),
    degraded: truncated,
    coverage: truncated ? 'partial' : visible.length === 0 ? 'empty' : 'complete',
  }
}
