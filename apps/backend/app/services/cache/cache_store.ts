/**
 * v2-redis-minimum-runtime-support —— 最小缓存抽象（design D5, tasks 4.1-4.2）。
 *
 * `CacheStore` 是 Compiler Stage 等命名用例的可选加速层：命中与否都不得改变确定性结果，
 * 因此缓存只按输入键读写、TTL 过期即重算，并强制 `org:<organization_id>:` 命名空间前缀
 * 对齐「组织级数据隔离」红线，禁止跨组织读取。
 *
 * 提供内存与 Redis 两实现；由工厂（cache_factory）按 Redis 可用性选择。消费者只依赖接口，
 * 不直接 import Redis，也不假设某一实现。
 */
import { createHash } from 'node:crypto'

/** 缓存值统一存为字符串（JSON 序列化由调用方负责，保持实现无关）。 */
export interface CacheStore {
  /** 读取。未命中或已过期返回 null。 */
  get(organizationId: number, key: string): Promise<string | null>
  /** 写入，ttlSeconds 秒后过期。ttl<=0 视为不写入。 */
  set(organizationId: number, key: string, value: string, ttlSeconds: number): Promise<void>
  /** 删除。 */
  delete(organizationId: number, key: string): Promise<void>
  /**
   * 组织范围盘点（v2-5-compiler-cache-management-api, design D2）。
   * 返回当前生效 storeKind、组织范围内匹配 `keyPrefix?` 的条目计数与有限条低敏 key-hash。
   * 绝不返回缓存值正文、raw key（key 只以 SHA-256 出现）。
   * 异常按静默降级惯例返回空盘点（D3），绝不冒泡为请求失败。
   */
  inventory(organizationId: number, keyPrefix?: string): Promise<CacheInventoryResult>
  /**
   * 按范围失效（design D2）：清除组织范围内匹配 `keyPrefix` 的条目，返回清除计数。
   * 结构性以 `org:<organizationId>:` 前缀为范围，禁止越组织。
   * 异常静默降级为 best-effort 已删计数（D3），绝不冒泡。
   */
  invalidateByScope(organizationId: number, keyPrefix: string): Promise<CacheInvalidateResult>
}

/** 缓存盘点结果（低敏：storeKind + 计数 + 有限条 key 的 SHA-256，绝不含缓存值）。 */
export interface CacheInventoryResult {
  storeKind: 'memory' | 'redis' | 'unknown'
  /** 匹配范围内的条目计数（已过期条目不计入）。 */
  count: number
  /** 有限条完整缓存键的 SHA-256（可比对、不可反推键内容），上限 SAMPLE_KEY_HASH_LIMIT。 */
  sampleKeyHashes: string[]
  /** 枚举/降级时为 true，调用方据此标记盘点为尽力而为。 */
  degraded?: boolean
}

/** 按范围失效结果。 */
export interface CacheInvalidateResult {
  storeKind: 'memory' | 'redis' | 'unknown'
  /** 实际清除条目计数（best-effort 快照，并发下可能偏差）。 */
  removedCount: number
  /** 枚举/删除失败时为 true，removedCount 为尽力而为。 */
  degraded?: boolean
}

/** 盘点返回的 key-hash 条数上限（低敏 + 不泄漏规模细节的平衡，design Open Questions）。 */
export const SAMPLE_KEY_HASH_LIMIT = 10

/** 缓存域前缀，隔离缓存键与限流/探针键空间。 */
export const CACHE_KEY_PREFIX = 'aiproj:cache:'

/** 构造组织命名空间键：`aiproj:cache:org:<organizationId>:<key>`。
 * 两个组织相同逻辑键因前缀不同而隔离。
 */
export function namespacedKey(organizationId: number, key: string): string {
  return `${CACHE_KEY_PREFIX}org:${organizationId}:${key}`
}

/**
 * 完整缓存键的 SHA-256（design D2 低敏）：盘点只暴露 key-hash，绝不暴露 raw key 或缓存值。
 */
export function hashKey(fullKey: string): string {
  return createHash('sha256').update(fullKey).digest('hex')
}

interface MemoryEntry {
  value: string
  expiresAt: number
}

/**
 * 内存缓存实现：默认路径与 Redis 不可用时的降级实现。
 * 单进程内存，重启/多进程不共享，符合 V1 单节点语义；作为加速层足够。
 */
export class MemoryCacheStore implements CacheStore {
  readonly #map = new Map<string, MemoryEntry>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  async get(organizationId: number, key: string): Promise<string | null> {
    const k = namespacedKey(organizationId, key)
    const entry = this.#map.get(k)
    if (!entry) return null
    if (entry.expiresAt <= this.#now()) {
      this.#map.delete(k)
      return null
    }
    return entry.value
  }

  async set(organizationId: number, key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return
    const k = namespacedKey(organizationId, key)
    this.#map.set(k, { value, expiresAt: this.#now() + ttlSeconds * 1000 })
  }

  async delete(organizationId: number, key: string): Promise<void> {
    this.#map.delete(namespacedKey(organizationId, key))
  }

  /**
   * 组织范围盘点（design D2）：遍历 #map 按 `org:<orgId>:` + 可选子前缀过滤计数，
   * 跳过已过期条目，返回有限条 key 的 SHA-256；绝不返回缓存值正文。
   */
  async inventory(organizationId: number, keyPrefix?: string): Promise<CacheInventoryResult> {
    const scopePrefix = namespacedKey(organizationId, keyPrefix ?? '')
    const sampleKeyHashes: string[] = []
    let count = 0
    const now = this.#now()
    for (const [k, entry] of this.#map) {
      if (!k.startsWith(scopePrefix)) continue
      if (entry.expiresAt <= now) {
        // 已过期：不计数（与 get 的过期语义一致），顺带清理。
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
   * 按范围失效（design D2）：遍历 #map 删除 `org:<orgId>:` + 子前缀匹配的条目，返回清除计数。
   * 结构性禁止越组织（前缀强制带 orgId）。
   */
  async invalidateByScope(
    organizationId: number,
    keyPrefix: string,
  ): Promise<CacheInvalidateResult> {
    const scopePrefix = namespacedKey(organizationId, keyPrefix)
    let removedCount = 0
    for (const k of [...this.#map.keys()]) {
      if (k.startsWith(scopePrefix)) {
        this.#map.delete(k)
        removedCount++
      }
    }
    return { storeKind: 'memory', removedCount }
  }

  /** 测试辅助：清空全部条目。 */
  clear(): void {
    this.#map.clear()
  }
}

/**
 * RedisCacheStore 依赖的最小客户端契约（ioredis 兼容子集）。
 * 由工厂注入真实 Adonis redis 连接；单元测试可注入内存假实现验证等价语义。
 *
 * v2-5-compiler-cache-management-api（design D3）：扩展 `scan`/多键 `del` 子集，
 * 用于组织范围盘点与按范围失效；既有 `get/set/del` 单键语义不变。
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
  /**
   * SCAN 游标分批枚举（ioredis 兼容）。
   * 返回 `[nextCursor, keys[]]`；`nextCursor === '0'` 表示枚举完成。
   * 工厂注入的真实连接实现此方法；假实现可在测试中省略（走降级）。
   */
  scan?(cursor: string, match: string, count: number): Promise<[string, string[]]>
  /**
   * 多键删除（ioredis 兼容 `del(...keys)`）。返回删除数。
   */
  delKeys?(keys: string[]): Promise<number>
}

/**
 * Redis 缓存实现：进程外共享加速层。
 * 所有异常内部消化并返回安全默认（读失败→null、写/删失败→静默），
 * 禁止把 Redis 错误冒泡为面向用户的请求失败（design D2 运行期降级）。
 */
export class RedisCacheStore implements CacheStore {
  readonly #client: RedisLikeClient

  constructor(client: RedisLikeClient) {
    this.#client = client
  }

  async get(organizationId: number, key: string): Promise<string | null> {
    try {
      return await this.#client.get(namespacedKey(organizationId, key))
    } catch {
      return null
    }
  }

  async set(organizationId: number, key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return
    try {
      await this.#client.set(namespacedKey(organizationId, key), value, 'EX', ttlSeconds)
    } catch {
      // 加速层写失败不影响确定性结果，静默降级
    }
  }

  async delete(organizationId: number, key: string): Promise<void> {
    try {
      await this.#client.del(namespacedKey(organizationId, key))
    } catch {
      // 静默
    }
  }

  /**
   * 组织范围盘点（design D2/D3）：经 `SCAN MATCH` 游标分批枚举 `org:<orgId>:` + 子前缀键，
   * 计数并取有限条 key-hash。SCAN 失败 → 空盘点 + degraded 标记，绝不冒泡（D3）。
   */
  async inventory(organizationId: number, keyPrefix?: string): Promise<CacheInventoryResult> {
    const scopePattern = `${namespacedKey(organizationId, keyPrefix ?? '')}*`
    if (typeof this.#client.scan !== 'function') {
      // 客户端未实现 scan 子集：安全降级为空盘点（D3）。
      return { storeKind: 'redis', count: 0, sampleKeyHashes: [], degraded: true }
    }
    const sampleKeyHashes: string[] = []
    let count = 0
    let cursor = '0'
    try {
      do {
        const [nextCursor, keys] = await this.#client.scan(cursor, scopePattern, 100)
        cursor = nextCursor
        count += keys.length
        for (const k of keys) {
          if (sampleKeyHashes.length < SAMPLE_KEY_HASH_LIMIT) {
            sampleKeyHashes.push(hashKey(k))
          }
        }
      } while (cursor !== '0')
    } catch {
      // D3：枚举失败返回 best-effort 已收集计数，标记 degraded。
      return { storeKind: 'redis', count, sampleKeyHashes, degraded: true }
    }
    return { storeKind: 'redis', count, sampleKeyHashes }
  }

  /**
   * 按范围失效（design D2/D3）：SCAN 收集 `org:<orgId>:` + 子前缀键后多键 del。
   * 异常静默降级为 best-effort 已删计数，绝不冒泡。
   */
  async invalidateByScope(
    organizationId: number,
    keyPrefix: string,
  ): Promise<CacheInvalidateResult> {
    const scopePattern = `${namespacedKey(organizationId, keyPrefix)}*`
    if (typeof this.#client.scan !== 'function' || typeof this.#client.delKeys !== 'function') {
      return { storeKind: 'redis', removedCount: 0, degraded: true }
    }
    let removedCount = 0
    let degraded = false
    let cursor = '0'
    try {
      do {
        const [nextCursor, keys] = await this.#client.scan(cursor, scopePattern, 100)
        cursor = nextCursor
        if (keys.length > 0) {
          try {
            removedCount += await this.#client.delKeys(keys)
          } catch {
            // 删除失败：best-effort，标记 degraded 但继续游标推进。
            degraded = true
          }
        }
      } while (cursor !== '0')
    } catch {
      degraded = true
    }
    return { storeKind: 'redis', removedCount, degraded }
  }
}
