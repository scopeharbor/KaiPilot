/**
 * v2-redis-minimum-runtime-support —— Compiler Stage 缓存用例（design D5, task 4.3）。
 * v2-5-compiler-stage-cache-wiring —— 生产指纹入口与低敏缓存摘要（design D3/D4/D5/D6, tasks 1.3, 4.1）。
 *
 * 把「deterministic Stage 结果缓存」接到统一的 `CacheStore` 接口：缓存键 = stageId + 输入内容哈希，
 * 因此缓存只是加速层，命中与否都返回同一确定性结果，TTL 过期即重算。CacheStore 由工厂按
 * Redis 可用性选择（缺 Redis 走内存），本服务不直接假设 Redis。
 *
 * 组织隔离由 CacheStore 的 `org:<organization_id>:` 命名空间前缀强制。
 *
 * 失败语义（design D5）：读异常、腐坏 JSON、写异常、Redis 不可用一律降级为
 * miss 重算或 memory fallback，绝不把缓存错误冒泡为 Stage 失败。
 */
import env from '#start/env'
import { computeContentHash } from './artifact_store.js'
import { resolveCacheStore } from '#services/cache/cache_factory'
import { MemoryCacheStore, RedisCacheStore, type CacheStore } from '#services/cache/cache_store'
import {
  withTenantConnectionLease,
  poolTenantContextFor,
} from '#services/tenant_connection_pool_wrapper'
import {
  stageCacheKeyFromFingerprint,
  type StageCacheFingerprint,
} from './stage_cache_fingerprint.js'

/** 缓存键：stage:<stageId>:<输入内容哈希>。相同输入命中同一键，保证确定性。 */
export function stageCacheKey(stageId: string, input: unknown): string {
  return `stage:${stageId}:${computeContentHash(input)}`
}

// ── v2-5-compiler-stage-cache-wiring：生产指纹入口与低敏摘要 ──

/**
 * 缓存状态（design D4/D5，task 4.1）。
 * - `hit`：命中，直接复用缓存值。
 * - `miss`：未命中（含读异常降级），已重算并尝试写入。
 * - `corrupt-recompute`：缓存 JSON 腐坏，重算并覆盖。
 * - `write-failed`：计算成功但写缓存失败（结果仍正常返回）。
 * - `bypass` / `fallback` / `feature-off`：保留给观测面的状态词；
 *   本 change 的 Executor 对 bypass/feature-off 不写摘要（design D6），仅在此封闭状态集合。
 */
export type StageCacheStatus =
  'hit' | 'miss' | 'corrupt-recompute' | 'write-failed' | 'bypass' | 'fallback' | 'feature-off'

/** 实际生效的 store 类型（低敏，只暴露种类不暴露连接信息）。 */
export type StageCacheStoreKind = 'memory' | 'redis' | 'unknown'

/**
 * 低敏缓存摘要（design D4）。禁止包含 raw input/prompt/context/model output、
 * token、secret、provider payload 或完整缓存键——键只以 `cacheKeyHash` 出现。
 */
export interface StageCacheSummary {
  status: StageCacheStatus
  /** 完整缓存键的 SHA-256（可比对、不可反推键内容）。 */
  cacheKeyHash: string
  cachePolicyVersion: string
  storeKind: StageCacheStoreKind
  /** 缓存层读写耗时（不含 handler 计算耗时）。 */
  durationMs: number
}

export interface StageCacheDetailedResult<T> {
  value: T
  summary: StageCacheSummary
}

/** 判定 store 种类（只用于低敏摘要）。 */
function storeKindOf(store: CacheStore): StageCacheStoreKind {
  if (store instanceof MemoryCacheStore) return 'memory'
  if (store instanceof RedisCacheStore) return 'redis'
  return 'unknown'
}

/**
 * 本地特性门禁（design D6）：默认启用；`COMPILER_STAGE_CACHE_ENABLED=false` 时
 * Orchestrator 构造 Executor 不再接缓存（与 STREAMING_WS_ENABLED 同款 env flag 惯例）。
 */
export function isCompilerStageCacheEnabled(): boolean {
  return env.get('COMPILER_STAGE_CACHE_ENABLED', true)
}

/**
 * 带组织覆盖的特性门禁（v2-5-compiler-config-management-api, task 5.2）。
 * 解析顺序：org active profile → env → 系统默认。
 * 无 profile 时回落 env/系统默认（零行为变化）。
 * 消费点由后续接线 change 切换至此函数。
 */
export async function isCompilerStageCacheEnabledForOrg(organizationId: number): Promise<boolean> {
  const { getEffectiveConfig } = await import('#services/compiler/compiler_config_service')
  const config = await getEffectiveConfig(organizationId)
  if (config.source === 'profile' && config.featureToggles.stageCacheEnabled !== undefined) {
    return config.featureToggles.stageCacheEnabled
  }
  return isCompilerStageCacheEnabled()
}

export class StageCacheService {
  readonly #store: CacheStore | null
  readonly #ttlSeconds: number

  /**
   * @param store 显式注入 CacheStore（测试/特定场景）；不传则每次经工厂解析当前生效实现。
   * @param ttlSeconds 默认 TTL。
   */
  constructor(store: CacheStore | null = null, ttlSeconds = 3600) {
    this.#store = store
    this.#ttlSeconds = ttlSeconds
  }

  async #resolveStore(): Promise<CacheStore> {
    return this.#store ?? (await resolveCacheStore())
  }

  /**
   * 在 `compiler:artifact` 租户连接 lease 保护下访问 Stage 缓存存储
   * （v3-multitenant-connection-pool-management §5.5）。
   *
   * 只包裹**存储访问**，不包裹 handler 的 compute()：lease 治的是连接资源并发，
   * 不应把整个 Stage 计算时长算进 artifact 预算。
   *
   * 调用方仍在 try/catch 内使用：lease 耗尽/超时与存储异常同样降级为 miss /
   * write-failed，绝不冒泡为 Stage 失败（stage-cache design D5）。
   */
  async #underArtifactLease<T>(
    organizationId: number,
    operationKind: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withTenantConnectionLease(
      {
        resourceKey: 'compiler:artifact',
        operationKind,
        tenant: poolTenantContextFor({ organizationId }),
        requestId: `stage-cache:${organizationId}`,
      },
      fn,
    )
  }

  /**
   * 取缓存或计算：命中反序列化返回；未命中调用 compute 得到确定性结果，写缓存后返回。
   *
   * 契约：对相同 (organizationId, stageId, input)，无论命中与否、无论 Redis 是否可用，
   * 返回值必须与 compute() 一致——缓存只作加速层，禁止改变确定性输出。
   */
  async getOrCompute<T>(
    organizationId: number,
    stageId: string,
    input: unknown,
    compute: () => Promise<T>,
    ttlSeconds: number = this.#ttlSeconds,
  ): Promise<T> {
    const store = await this.#resolveStore()
    const key = stageCacheKey(stageId, input)

    let cached: string | null = null
    try {
      cached = await this.#underArtifactLease(organizationId, 'stage_cache_read', () =>
        store.get(organizationId, key),
      )
    } catch {
      // lease 耗尽/超时或存储异常一律按 miss 处理，缓存层不改变确定性输出。
      cached = null
    }
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T
      } catch {
        // 缓存损坏视为未命中，重算并覆盖，绝不影响确定性结果。
      }
    }

    const result = await compute()
    try {
      await this.#underArtifactLease(organizationId, 'stage_cache_write', () =>
        store.set(organizationId, key, JSON.stringify(result), ttlSeconds),
      )
    } catch {
      // 写缓存失败（含 lease 耗尽）不冒泡为 Stage 失败。
    }
    return result
  }

  /**
   * 生产指纹入口（v2-5-compiler-stage-cache-wiring, tasks 1.3, design D3/D5）：
   * 与 `getOrCompute` 同契约（命中与否返回确定性等价结果），但
   * - 缓存键来自版本化指纹（contract/cache policy/handler 版本变化即构造性失效）；
   * - 返回低敏 `StageCacheSummary`（status/cacheKeyHash/cachePolicyVersion/storeKind/durationMs）；
   * - 读异常→miss 重算；缓存 JSON 腐坏→corrupt-recompute 并覆盖；写异常→write-failed
   *   但仍返回计算结果（缓存失败绝不冒泡为 Stage 失败）。
   */
  async getOrComputeDetailed<T>(
    organizationId: number,
    fingerprint: StageCacheFingerprint,
    compute: () => Promise<T>,
    ttlSeconds: number = this.#ttlSeconds,
  ): Promise<StageCacheDetailedResult<T>> {
    const store = await this.#resolveStore()
    const key = stageCacheKeyFromFingerprint(fingerprint)
    const summaryBase = {
      cacheKeyHash: computeContentHash(key),
      cachePolicyVersion: fingerprint.cachePolicyVersion,
      storeKind: storeKindOf(store),
    }

    // 只累计缓存层读写耗时，不含 handler 计算耗时。
    let cacheDurationMs = 0

    let cached: string | null = null
    const readStartedAt = Date.now()
    try {
      cached = await this.#underArtifactLease(organizationId, 'stage_cache_read', () =>
        store.get(organizationId, key),
      )
    } catch {
      // D5：读异常（含 Redis 不可用）按 miss 处理，继续重算。
    } finally {
      cacheDurationMs += Date.now() - readStartedAt
    }

    if (cached !== null) {
      try {
        const value = JSON.parse(cached) as T
        return {
          value,
          summary: { ...summaryBase, status: 'hit', durationMs: cacheDurationMs },
        }
      } catch {
        // 缓存腐坏：按 miss 重算并覆盖（design D5 corrupt-recompute）。
        const value = await compute()
        const write = await this.#tryWrite(store, organizationId, key, value, ttlSeconds)
        cacheDurationMs += write.durationMs
        return {
          value,
          summary: {
            ...summaryBase,
            status: write.failed ? 'write-failed' : 'corrupt-recompute',
            durationMs: cacheDurationMs,
          },
        }
      }
    }

    const value = await compute()
    const write = await this.#tryWrite(store, organizationId, key, value, ttlSeconds)
    cacheDurationMs += write.durationMs
    return {
      value,
      summary: {
        ...summaryBase,
        status: write.failed ? 'write-failed' : 'miss',
        durationMs: cacheDurationMs,
      },
    }
  }

  /**
   * 写缓存失败不冒泡（D5）：返回失败标记与耗时，由调用方记 write-failed 摘要。
   */
  async #tryWrite(
    store: CacheStore,
    organizationId: number,
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<{ failed: boolean; durationMs: number }> {
    const startedAt = Date.now()
    try {
      await this.#underArtifactLease(organizationId, 'stage_cache_write', () =>
        store.set(organizationId, key, JSON.stringify(value), ttlSeconds),
      )
      return { failed: false, durationMs: Date.now() - startedAt }
    } catch {
      return { failed: true, durationMs: Date.now() - startedAt }
    }
  }
}
