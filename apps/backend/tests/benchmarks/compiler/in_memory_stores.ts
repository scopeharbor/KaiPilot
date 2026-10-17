/**
 * v2-5-compiler-execution-gap-benchmark —— 内存 store（tasks 1.3, 1.4）。
 *
 * design D5：benchmark 优先走内存 store。这里的两个 fake 继承既有类并覆写全部
 * 被执行器调用的方法，**不触碰任何 Lucid 模型**——因此「不污染正式数据」不是靠
 * 测试后清理保证的，而是结构性保证：这条路径上根本没有数据库句柄。
 *
 * ⚠️ 只覆写 `PipelineExecutor` 实际调用的方法。若将来执行器开始调用其它方法，
 * 会落到父类实现并立刻触发真实 DB 访问而报错——这是有意的失败方式，好过静默写库。
 */

import type CompilerArtifact from '#models/compiler_artifact'
import type { ArtifactKind } from '#models/compiler_artifact'
import { ArtifactStore } from '#services/compiler/artifact_store'
import type { ArtifactRecord } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'
import type { StageEventEntry } from '#services/compiler/stage_event_logger'
import type { StageCacheSummary } from '#services/compiler/stage_cache_service'
import {
  SAMPLE_KEY_HASH_LIMIT,
  hashKey,
  type CacheStore,
  type CacheInventoryResult,
  type CacheInvalidateResult,
} from '#services/cache/cache_store'

/** 内存中保存的 artifact 行（只保留 benchmark 需要读的字段）。 */
export interface InMemoryArtifact {
  id: number
  compilerRunId: number
  organizationId: number
  kind: ArtifactKind
  stageId: string | null
  artifactId: string | null
  version: number
  contentHash: string | null
  payload: Record<string, unknown>
}

/**
 * 内存 ArtifactStore。
 *
 * 覆写执行器用到的 `save` / `getCheckpoints` / `getStageOutputs`，
 * 其余继承自父类（一旦被调用会因缺少 DB 而失败，见文件头说明）。
 */
export class InMemoryArtifactStore extends ArtifactStore {
  readonly records: InMemoryArtifact[] = []
  #nextId = 1

  override async save(record: ArtifactRecord): Promise<CompilerArtifact> {
    const row: InMemoryArtifact = {
      id: this.#nextId++,
      compilerRunId: record.compilerRunId,
      organizationId: record.organizationId,
      kind: record.kind,
      stageId: record.stageId ?? null,
      artifactId: record.artifactId ?? null,
      version: record.version,
      contentHash: record.contentHash ?? null,
      payload: record.payload as Record<string, unknown>,
    }
    this.records.push(row)
    return row as unknown as CompilerArtifact
  }

  override async getCheckpoints(runId: number): Promise<CompilerArtifact[]> {
    // 与生产实现一致：按 version 降序，使 [0] 为最新 checkpoint。
    return this.records
      .filter((r) => r.compilerRunId === runId && r.kind === 'checkpoint')
      .sort((a, b) => b.version - a.version) as unknown as CompilerArtifact[]
  }

  override async getStageOutputs(runId: number, stageId?: string): Promise<CompilerArtifact[]> {
    return this.records
      .filter(
        (r) =>
          r.compilerRunId === runId &&
          r.kind === 'stage_output' &&
          (stageId === undefined || r.stageId === stageId),
      )
      .sort((a, b) => a.version - b.version) as unknown as CompilerArtifact[]
  }

  /** 按 kind 统计，供报告的 artifact 证据使用。 */
  countByKind(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const r of this.records) {
      counts[r.kind] = (counts[r.kind] ?? 0) + 1
    }
    return counts
  }

  clear(): void {
    this.records.length = 0
    this.#nextId = 1
  }
}

/** 内存中记录的 stage 事件。 */
export interface InMemoryStageEvent {
  compilerRunId: number
  organizationId: number
  stageId: string
  phase: string
  status: string
  contextPacketRef: string | null
  modelOutputRef: string | null
  outputArtifactRefs: string[]
  durationMs: number | null
  llmCalls: number
  error: Record<string, unknown> | null
  /** v2-5-compiler-stage-cache-wiring：低敏缓存摘要（未接缓存的 stage 为 null）。 */
  cacheSummary: StageCacheSummary | null
}

type PartialEntry = Partial<StageEventEntry>

/**
 * 内存 StageEventLogger。
 *
 * 覆写全部五个写入方法；执行器只会走这些入口，因此不存在落到父类的路径。
 */
export class InMemoryStageEventLogger extends StageEventLogger {
  readonly events: InMemoryStageEvent[] = []

  #record(entry: PartialEntry, status: string): void {
    this.events.push({
      compilerRunId: entry.compilerRunId ?? 0,
      organizationId: entry.organizationId ?? 0,
      stageId: entry.stageId ?? '',
      phase: entry.phase ?? '',
      status,
      contextPacketRef: entry.contextPacketRef ?? null,
      modelOutputRef: entry.modelOutputRef ?? null,
      outputArtifactRefs: entry.outputArtifactRefs ?? [],
      durationMs: entry.durationMs ?? null,
      llmCalls: entry.llmCalls ?? 0,
      error: entry.error ?? null,
      cacheSummary: entry.cacheSummary ?? null,
    })
  }

  override async started(
    entry: Omit<StageEventEntry, 'status' | 'endedAt' | 'durationMs'>,
  ): Promise<void> {
    this.#record(entry, 'running')
  }

  override async succeeded(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    this.#record(entry, 'completed')
  }

  override async failed(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    this.#record(entry, 'failed')
  }

  override async skipped(
    entry: Omit<StageEventEntry, 'status' | 'durationMs' | 'llmCalls' | 'llmCost'>,
  ): Promise<void> {
    this.#record(entry, 'skipped')
  }

  override async needsHumanReview(entry: Omit<StageEventEntry, 'status'>): Promise<void> {
    this.#record(entry, 'needs_human_review')
  }

  countByStatus(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const e of this.events) {
      counts[e.status] = (counts[e.status] ?? 0) + 1
    }
    return counts
  }

  clear(): void {
    this.events.length = 0
  }
}

/**
 * 计数型内存 CacheStore。
 *
 * 复用 `MemoryCacheStore` 的语义（org 命名空间 + TTL）不够——benchmark 需要
 * hit/miss 计数作为缓存证据，故在此实现一个带计数的等价 store。
 */
export class CountingMemoryCacheStore implements CacheStore {
  readonly #map = new Map<string, { value: string; expiresAt: number }>()
  hits = 0
  misses = 0

  #key(organizationId: number, key: string): string {
    return `org:${organizationId}:${key}`
  }

  async get(organizationId: number, key: string): Promise<string | null> {
    const k = this.#key(organizationId, key)
    const entry = this.#map.get(k)
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) this.#map.delete(k)
      this.misses++
      return null
    }
    this.hits++
    return entry.value
  }

  async set(organizationId: number, key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return
    this.#map.set(this.#key(organizationId, key), {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  async delete(organizationId: number, key: string): Promise<void> {
    this.#map.delete(this.#key(organizationId, key))
  }

  /**
   * 组织范围盘点（对齐 `CacheStore` 接口 v2-5-compiler-cache-management-api）。
   * 遍历 `#map` 按 `org:<orgId>:` + 子前缀过滤计数，跳过已过期条目，返回有限条 key-hash。
   */
  async inventory(organizationId: number, keyPrefix?: string): Promise<CacheInventoryResult> {
    const scopePrefix = this.#key(organizationId, keyPrefix ?? '')
    const sampleKeyHashes: string[] = []
    let count = 0
    const now = Date.now()
    for (const [k, entry] of this.#map) {
      if (!k.startsWith(scopePrefix)) continue
      if (entry.expiresAt <= now) {
        this.#map.delete(k)
        continue
      }
      count++
      if (sampleKeyHashes.length < SAMPLE_KEY_HASH_LIMIT) {
        sampleKeyHashes.push(hashKey(k))
      }
    }
    return { storeKind: 'memory', count, sampleKeyHashes }
  }

  /**
   * 按范围失效：删除 `org:<orgId>:` + 子前缀匹配的条目，返回清除计数。
   * 结构性禁止越组织（前缀强制带 orgId）。
   */
  async invalidateByScope(
    organizationId: number,
    keyPrefix: string,
  ): Promise<CacheInvalidateResult> {
    const scopePrefix = this.#key(organizationId, keyPrefix)
    let removedCount = 0
    for (const k of [...this.#map.keys()]) {
      if (k.startsWith(scopePrefix)) {
        this.#map.delete(k)
        removedCount++
      }
    }
    return { storeKind: 'memory', removedCount }
  }

  clear(): void {
    this.#map.clear()
    this.hits = 0
    this.misses = 0
  }
}
