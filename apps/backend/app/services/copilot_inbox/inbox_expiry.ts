/**
 * v3-copilot-suggestion-inbox — 过期判定器（任务 5.6–5.10）
 *
 * 复用 per-source freshness，source hash 失配即标记过期。
 * 过期范围限定为该建议依赖的具体事实。
 * 过期时必须说明原因。
 * 不静默丢弃过期条目。
 */

import type { InboxEntry, InboxSourceRef, InboxExpiryReasonKind } from '@aiproj/types'
import { InboxSourceFreshnessCheckerImpl } from './inbox_production_wiring.js'

/**
 * 过期判定结果。
 */
export interface InboxExpiryResult {
  /** 是否已过期 */
  expired: boolean
  /** 过期原因（expired=true 时必填） */
  reason: InboxExpiryReasonKind | null
  /** 过期详情说明 */
  detail: string | null
}

/**
 * 来源 freshness 检查器接口。
 */
export interface InboxSourceFreshnessChecker {
  /**
   * 检查来源引用的 freshness。
   * 返回当前 hash 与来源当前 hash 是否匹配。
   */
  checkFreshness(sourceRef: InboxSourceRef): Promise<{
    fresh: boolean
    currentHash: string | null
    reason: InboxExpiryReasonKind | null
    detail: string | null
  }>
}

/**
 * 过期判定器。
 */
export class InboxExpiryChecker {
  constructor(
    private freshnessChecker: InboxSourceFreshnessChecker = new InboxSourceFreshnessCheckerImpl(),
  ) {}

  /**
   * 检查条目是否应过期。
   * 遍历所有来源引用，检查每个的 freshness。
   * 任一来源过期 → 条目过期。
   */
  async checkExpiry(entry: InboxEntry): Promise<InboxExpiryResult> {
    // 已经是终态的条目不再检查过期
    if (entry.state === 'expired' || entry.state === 'adopted' || entry.state === 'dismissed') {
      return { expired: false, reason: null, detail: null }
    }

    for (const sourceRef of entry.sourceRefs) {
      const result = await this.freshnessChecker.checkFreshness(sourceRef)
      if (!result.fresh) {
        return {
          expired: true,
          reason: result.reason ?? 'other_changed',
          detail: result.detail ?? `${sourceRef.sourceKind} 数据已变更`,
        }
      }
    }

    return { expired: false, reason: null, detail: null }
  }

  /**
   * 批量检查条目过期状态。
   */
  async checkBatchExpiry(entries: InboxEntry[]): Promise<Map<string, InboxExpiryResult>> {
    const results = new Map<string, InboxExpiryResult>()
    await Promise.all(
      entries.map(async (entry) => {
        const result = await this.checkExpiry(entry)
        results.set(entry.id, result)
      }),
    )
    return results
  }
}
