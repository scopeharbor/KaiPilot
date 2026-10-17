import type { PmoInvestmentDistributionSummary } from '@aiproj/types'

/**
 * PMO 投入分布可选派生缓存（v3-pmo-investment-distribution §4.13）。
 *
 * 设计约束（design D6 / Migration Plan 3）：
 * - 纯进程内 TTL Map，**不依赖 Redis / PostgreSQL / Kafka / VectorDB / 容器**，
 *   本机 SQLite 开发默认可关闭；关闭时读路径照常 bounded 聚合。
 * - 缓存只是加速层，不是事实来源：命中前必须比对来源签名，签名变化即视为未命中。
 * - 只缓存已按组织、actor、权限脱敏后的只读结果，缓存键包含 actorId，
 *   避免跨用户复用越权数据。
 */

export type InvestmentCacheMissReason =
  'disabled' | 'miss' | 'expired' | 'signature_changed' | 'hit'

export interface InvestmentCacheLookup {
  hit: boolean
  reason: InvestmentCacheMissReason
  summary: PmoInvestmentDistributionSummary | null
}

interface InvestmentCacheEntry {
  organizationId: number
  summary: PmoInvestmentDistributionSummary
  sourceSignature: string
  storedAt: number
}

export interface InvestmentCacheOptions {
  enabled?: boolean
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

export const PMO_INVESTMENT_CACHE_DEFAULT_TTL_MS = 60_000
export const PMO_INVESTMENT_CACHE_DEFAULT_MAX_ENTRIES = 200

export default class PmoInvestmentDistributionCache {
  private readonly store = new Map<string, InvestmentCacheEntry>()
  private readonly enabled: boolean
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: InvestmentCacheOptions = {}) {
    this.enabled = options.enabled ?? false
    this.ttlMs = options.ttlMs ?? PMO_INVESTMENT_CACHE_DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? PMO_INVESTMENT_CACHE_DEFAULT_MAX_ENTRIES
    this.now = options.now ?? (() => Date.now())
  }

  isEnabled(): boolean {
    return this.enabled
  }

  get(key: string, expectedSignature: string): InvestmentCacheLookup {
    if (!this.enabled) return { hit: false, reason: 'disabled', summary: null }

    const entry = this.store.get(key)
    if (!entry) return { hit: false, reason: 'miss', summary: null }

    if (this.now() - entry.storedAt > this.ttlMs) {
      this.store.delete(key)
      return { hit: false, reason: 'expired', summary: null }
    }

    if (entry.sourceSignature !== expectedSignature) {
      this.store.delete(key)
      return { hit: false, reason: 'signature_changed', summary: null }
    }

    return { hit: true, reason: 'hit', summary: entry.summary }
  }

  set(
    key: string,
    organizationId: number,
    summary: PmoInvestmentDistributionSummary,
    sourceSignature: string,
  ): void {
    if (!this.enabled) return

    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey !== undefined) this.store.delete(oldestKey)
    }

    this.store.set(key, {
      organizationId,
      summary,
      sourceSignature,
      storedAt: this.now(),
    })
  }

  /** 组织级失效：来源事实变化或人工清理时调用，只清加速层条目。 */
  invalidateOrganization(organizationId: number): number {
    let removed = 0
    for (const [key, entry] of this.store.entries()) {
      if (entry.organizationId === organizationId) {
        this.store.delete(key)
        removed += 1
      }
    }
    return removed
  }

  clear(): void {
    this.store.clear()
  }

  size(): number {
    return this.store.size
  }
}

/**
 * 缓存键：组织 + actor + 归一化查询形状 + 指标版本。
 * 只包含低敏查询形状，不包含项目名、成员或证据文本。
 */
export function buildInvestmentCacheKey(input: {
  organizationId: number
  actorId: number
  metricVersion: string
  basis: string
  dimension: string
  displayMode: string
  topN: number
  trendWindow: string
  filterStatus?: string
  filterPriority?: string
  search?: string
}): string {
  return [
    input.metricVersion,
    input.organizationId,
    input.actorId,
    input.basis,
    input.dimension,
    input.displayMode,
    input.topN,
    input.trendWindow,
    input.filterStatus ?? '-',
    input.filterPriority ?? '-',
    input.search ? `s${input.search.length}` : '-',
  ].join('|')
}
