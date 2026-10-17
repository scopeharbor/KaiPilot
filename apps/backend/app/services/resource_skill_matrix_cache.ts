import type { ResourceSkillMatrixSummaryResponse } from '@aiproj/types'

/**
 * 资源技能矩阵可选派生缓存（v3-resource-skill-matrix §3.8）。
 *
 * 设计约束（design D2 / Migration Plan 3）：
 * - 纯进程内 TTL Map，**不依赖 Redis / PostgreSQL / Kafka / VectorDB / 容器**，
 *   本机 SQLite 开发默认可关闭；关闭时读路径照常 bounded 聚合。
 * - 缓存只是加速层，不是事实来源：命中前必须比对来源签名，签名变化即视为未命中。
 * - 只缓存已按组织、actor、权限脱敏后的只读结果，缓存键包含 actorId。
 */

export type MatrixCacheMissReason = 'disabled' | 'miss' | 'expired' | 'signature_changed' | 'hit'

export interface MatrixCacheLookup {
  hit: boolean
  reason: MatrixCacheMissReason
  summary: ResourceSkillMatrixSummaryResponse | null
}

interface MatrixCacheEntry {
  organizationId: number
  summary: ResourceSkillMatrixSummaryResponse
  sourceSignature: string
  storedAt: number
}

export interface MatrixCacheOptions {
  enabled?: boolean
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

export const MATRIX_CACHE_DEFAULT_TTL_MS = 60_000
export const MATRIX_CACHE_DEFAULT_MAX_ENTRIES = 200

export default class ResourceSkillMatrixCache {
  private readonly store = new Map<string, MatrixCacheEntry>()
  private readonly enabled: boolean
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: MatrixCacheOptions = {}) {
    this.enabled = options.enabled ?? false
    this.ttlMs = options.ttlMs ?? MATRIX_CACHE_DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? MATRIX_CACHE_DEFAULT_MAX_ENTRIES
    this.now = options.now ?? (() => Date.now())
  }

  isEnabled(): boolean {
    return this.enabled
  }

  get(key: string, expectedSignature: string): MatrixCacheLookup {
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
    summary: ResourceSkillMatrixSummaryResponse,
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
export function buildMatrixCacheKey(input: {
  organizationId: number
  actorId: number
  metricVersion: string
  scope: string
  topN: number
  groupBy: string
  sort: string
  from: string
  to: string
  search?: string
}): string {
  return [
    input.metricVersion,
    input.organizationId,
    input.actorId,
    input.scope,
    input.topN,
    input.groupBy,
    input.sort,
    input.from,
    input.to,
    input.search ? `s${input.search.length}` : '-',
  ].join('|')
}
