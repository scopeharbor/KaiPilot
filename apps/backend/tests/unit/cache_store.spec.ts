/**
 * v2-redis-minimum-runtime-support —— 缓存抽象单元测试（tasks 4.4）。
 *
 * 覆盖：
 * - 有无 Redis 结果等价（MemoryCacheStore vs RedisCacheStore+假客户端）
 * - 组织命名空间隔离（跨组织禁止读到彼此缓存）
 * - TTL 过期后重算
 * - Stage 缓存用例命中与否不改变确定性结果
 */
import { test } from '@japa/runner'
import {
  MemoryCacheStore,
  RedisCacheStore,
  namespacedKey,
  type RedisLikeClient,
} from '#services/cache/cache_store'

/** 内存假 Redis 客户端，支持 EX TTL（以注入时钟判定过期）+ scan/delKeys（缓存管理原语）。 */
function makeFakeRedis(now: () => number): RedisLikeClient & { size(): number } {
  const map = new Map<string, { value: string; expiresAt: number }>()
  return {
    async get(key) {
      const e = map.get(key)
      if (!e) return null
      if (e.expiresAt <= now()) {
        map.delete(key)
        return null
      }
      return e.value
    },
    async set(key, value, _mode, ttlSeconds) {
      map.set(key, { value, expiresAt: now() + ttlSeconds * 1000 })
    },
    async del(key) {
      map.delete(key)
    },
    async scan(_cursor, match, _count) {
      // 简化实现：忽略 cursor 分批，一次返回全部匹配键；match 为 glob（仅 * 通配）。
      const pattern = match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      const re = new RegExp(`^${pattern}$`)
      const keys = [...map.keys()].filter((k) => re.test(k))
      return ['0', keys]
    },
    async delKeys(keys) {
      let n = 0
      for (const k of keys) {
        if (map.delete(k)) n++
      }
      return n
    },
    size() {
      return map.size
    },
  }
}

test.group('CacheStore - 有无 Redis 结果等价', () => {
  test('内存实现与 Redis 实现读写返回等价结果', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    const redis = new RedisCacheStore(makeFakeRedis(() => Date.now()))

    await mem.set(1, 'k', 'v-value', 60)
    await redis.set(1, 'k', 'v-value', 60)

    assert.equal(await mem.get(1, 'k'), 'v-value')
    assert.equal(await redis.get(1, 'k'), 'v-value')
    assert.equal(await mem.get(1, 'k'), await redis.get(1, 'k'))
  })

  test('未命中两实现均返回 null', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    const redis = new RedisCacheStore(makeFakeRedis(() => Date.now()))
    assert.isNull(await mem.get(1, 'absent'))
    assert.isNull(await redis.get(1, 'absent'))
  })
})

test.group('CacheStore - 组织命名空间隔离', () => {
  test('相同逻辑键在不同组织下隔离（memory）', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'shared', 'org1', 60)
    await mem.set(2, 'shared', 'org2', 60)
    assert.equal(await mem.get(1, 'shared'), 'org1')
    assert.equal(await mem.get(2, 'shared'), 'org2')
  })

  test('相同逻辑键在不同组织下隔离（redis 假客户端）', async ({ assert }) => {
    const redis = new RedisCacheStore(makeFakeRedis(() => Date.now()))
    await redis.set(1, 'shared', 'org1', 60)
    await redis.set(2, 'shared', 'org2', 60)
    assert.equal(await redis.get(1, 'shared'), 'org1')
    assert.equal(await redis.get(2, 'shared'), 'org2')
  })

  test('命名空间键包含 org 前缀且组织不同则键不同', async ({ assert }) => {
    const k1 = namespacedKey(1, 'x')
    const k2 = namespacedKey(2, 'x')
    assert.include(k1, 'org:1:')
    assert.include(k2, 'org:2:')
    assert.notEqual(k1, k2)
  })
})

test.group('CacheStore - TTL 过期重算', () => {
  test('TTL 过期后返回 null（memory）', async ({ assert }) => {
    let clock = 1_000_000
    const mem = new MemoryCacheStore(() => clock)
    await mem.set(1, 'k', 'v', 10) // 10s
    assert.equal(await mem.get(1, 'k'), 'v')
    clock += 11_000 // 前进 11s
    assert.isNull(await mem.get(1, 'k'))
  })

  test('TTL 过期后返回 null（redis 假客户端）', async ({ assert }) => {
    let clock = 1_000_000
    const redis = new RedisCacheStore(makeFakeRedis(() => clock))
    await redis.set(1, 'k', 'v', 10)
    assert.equal(await redis.get(1, 'k'), 'v')
    clock += 11_000
    assert.isNull(await redis.get(1, 'k'))
  })

  test('ttl<=0 不写入', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'k', 'v', 0)
    assert.isNull(await mem.get(1, 'k'))
  })
})

test.group('StageCacheService - 命中与否不改变确定性结果', () => {
  test('未命中计算并写缓存；命中返回等价结果', async ({ assert }) => {
    const { StageCacheService } = await import('#services/compiler/stage_cache_service')
    const store = new MemoryCacheStore()
    const svc = new StageCacheService(store)

    let computeCount = 0
    const input = { a: 1, b: [2, 3] }
    const compute = async () => {
      computeCount++
      return { result: 'deterministic', echo: input }
    }

    const first = await svc.getOrCompute(1, 'stage_x', input, compute)
    const second = await svc.getOrCompute(1, 'stage_x', input, compute)

    assert.deepEqual(first, second) // 命中与否结果等价
    assert.equal(computeCount, 1) // 第二次命中缓存，未重算
  })

  test('不同组织相同 stage/input 不串缓存', async ({ assert }) => {
    const { StageCacheService } = await import('#services/compiler/stage_cache_service')
    const store = new MemoryCacheStore()
    const svc = new StageCacheService(store)

    const input = { seed: 1 }
    const org1 = await svc.getOrCompute(1, 'stage_y', input, async () => ({ org: 1 }))
    const org2 = await svc.getOrCompute(2, 'stage_y', input, async () => ({ org: 2 }))

    assert.deepEqual(org1, { org: 1 })
    assert.deepEqual(org2, { org: 2 })
  })

  test('缓存键由 stageId + 输入内容哈希决定（相同输入同键）', async ({ assert }) => {
    const { stageCacheKey } = await import('#services/compiler/stage_cache_service')
    const k1 = stageCacheKey('s', { a: 1, b: 2 })
    const k2 = stageCacheKey('s', { a: 1, b: 2 })
    const k3 = stageCacheKey('s', { a: 1, b: 3 })
    assert.equal(k1, k2)
    assert.notEqual(k1, k3)
  })
})

// =============================================================================
// v2-5-compiler-cache-management-api —— 组织范围盘点/失效原语（tasks 1.4/1.5）
// =============================================================================

test.group('CacheStore - 组织范围盘点 inventory', () => {
  test('盘点本组织条目计数正确（memory）', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'v1', 60)
    await mem.set(1, 'stage:a:h2', 'v2', 60)
    await mem.set(1, 'stage:b:h3', 'v3', 60)
    await mem.set(2, 'stage:a:h1', 'other-org', 60)

    const inv = await mem.inventory(1)
    assert.equal(inv.storeKind, 'memory')
    assert.equal(inv.count, 3) // org 1 三条
  })

  test('盘点按子前缀细分（stage:a:）', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'v1', 60)
    await mem.set(1, 'stage:a:h2', 'v2', 60)
    await mem.set(1, 'stage:b:h3', 'v3', 60)

    const inv = await mem.inventory(1, 'stage:a:')
    assert.equal(inv.count, 2)
  })

  test('盘点低敏：不返回缓存值正文/raw key', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'SECRET-VALUE-123', 60)
    const inv = await mem.inventory(1)
    const json = JSON.stringify(inv)
    assert.notInclude(json, 'SECRET-VALUE-123') // 无缓存值正文
    assert.notInclude(json, 'stage:a:h1') // 无 raw key
    // sampleKeyHashes 为 SHA-256（64 hex）
    for (const h of inv.sampleKeyHashes) {
      assert.lengthOf(h, 64)
      assert.match(h, /^[0-9a-f]{64}$/)
    }
  })

  test('盘点不越组织：org2 盘点看不到 org1 条目', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'org1', 60)
    await mem.set(2, 'stage:a:h1', 'org2', 60)
    const inv1 = await mem.inventory(1)
    const inv2 = await mem.inventory(2)
    assert.equal(inv1.count, 1)
    assert.equal(inv2.count, 1)
    assert.lengthOf(inv1.sampleKeyHashes, 1)
    assert.lengthOf(inv2.sampleKeyHashes, 1)
    // 两组织相同逻辑键 → 完整命名空间键不同 → key-hash 不同
    assert.notEqual(inv1.sampleKeyHashes[0], inv2.sampleKeyHashes[0])
  })

  test('过期条目不计数（memory）', async ({ assert }) => {
    let clock = 1_000_000
    const mem = new MemoryCacheStore(() => clock)
    await mem.set(1, 'stage:a:h1', 'v1', 10)
    await mem.set(1, 'stage:a:h2', 'v2', 60)
    clock += 11_000 // h1 已过期
    const inv = await mem.inventory(1)
    assert.equal(inv.count, 1) // 仅 h2
  })

  test('sampleKeyHashes 条数上限', async ({ assert }) => {
    const { SAMPLE_KEY_HASH_LIMIT } = await import('#services/cache/cache_store')
    const mem = new MemoryCacheStore()
    for (let i = 0; i < 50; i++) {
      await mem.set(1, `stage:a:h${i}`, `v${i}`, 60)
    }
    const inv = await mem.inventory(1)
    assert.equal(inv.count, 50)
    assert.isAtMost(inv.sampleKeyHashes.length, SAMPLE_KEY_HASH_LIMIT)
  })
})

test.group('CacheStore - 按范围失效 invalidateByScope', () => {
  test('失效只清本组织匹配前缀（memory）', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'v1', 60)
    await mem.set(1, 'stage:a:h2', 'v2', 60)
    await mem.set(1, 'stage:b:h3', 'v3', 60)
    await mem.set(2, 'stage:a:h1', 'org2', 60)

    const res = await mem.invalidateByScope(1, 'stage:a:')
    assert.equal(res.removedCount, 2)
    assert.equal(res.storeKind, 'memory')
    assert.equal(await mem.get(1, 'stage:a:h1'), null)
    assert.equal(await mem.get(1, 'stage:b:h3'), 'v3') // 不匹配前缀保留
    assert.equal(await mem.get(2, 'stage:a:h1'), 'org2') // 跨组织不动
  })

  test('organization 级失效清本组织全部', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'v1', 60)
    await mem.set(1, 'stage:b:h2', 'v2', 60)
    await mem.set(2, 'stage:a:h1', 'org2', 60)

    const res = await mem.invalidateByScope(1, '')
    assert.equal(res.removedCount, 2)
    assert.equal(await mem.get(1, 'stage:a:h1'), null)
    assert.equal(await mem.get(2, 'stage:a:h1'), 'org2')
  })

  test('失效后单键热路径仍可正常读写（get/set/delete 契约不变）', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'stage:a:h1', 'v1', 60)
    await mem.invalidateByScope(1, 'stage:a:')
    // 失效后重写、读取、删除均正常
    await mem.set(1, 'stage:a:h1', 'v2', 60)
    assert.equal(await mem.get(1, 'stage:a:h1'), 'v2')
    await mem.delete(1, 'stage:a:h1')
    assert.isNull(await mem.get(1, 'stage:a:h1'))
  })
})

test.group('CacheStore - Redis 实现盘点/失效（假客户端）', () => {
  test('Redis inventory 与 invalidate 等价 memory 语义', async ({ assert }) => {
    const redis = new RedisCacheStore(makeFakeRedis(() => Date.now()))
    await redis.set(1, 'stage:a:h1', 'v1', 60)
    await redis.set(1, 'stage:a:h2', 'v2', 60)
    await redis.set(2, 'stage:a:h1', 'org2', 60)

    const inv = await redis.inventory(1, 'stage:a:')
    assert.equal(inv.storeKind, 'redis')
    assert.equal(inv.count, 2)

    const res = await redis.invalidateByScope(1, 'stage:a:')
    assert.equal(res.removedCount, 2)
    assert.isNull(await redis.get(1, 'stage:a:h1'))
    assert.equal(await redis.get(2, 'stage:a:h1'), 'org2') // 跨组织不动
  })

  test('Redis 客户端未实现 scan 时降级为空盘点（D3 不冒泡）', async ({ assert }) => {
    // 仅实现 get/set/del，无 scan/delKeys
    const minimal: RedisLikeClient = {
      async get() {
        return null
      },
      async set() {
        return 'OK'
      },
      async del() {
        return 1
      },
    }
    const redis = new RedisCacheStore(minimal)
    await redis.set(1, 'stage:a:h1', 'v', 60)
    const inv = await redis.inventory(1)
    assert.equal(inv.storeKind, 'redis')
    assert.equal(inv.count, 0)
    assert.isTrue(inv.degraded)

    const res = await redis.invalidateByScope(1, 'stage:a:')
    assert.isTrue(res.degraded)
    assert.equal(res.removedCount, 0)
  })

  test('Redis scan 抛错时降级不冒泡为请求失败', async ({ assert }) => {
    const throwingClient: RedisLikeClient = {
      async get() {
        return null
      },
      async set() {
        return 'OK'
      },
      async del() {
        return 1
      },
      async scan() {
        throw new Error('redis connection lost')
      },
      async delKeys(keys) {
        return keys.length
      },
    }
    const redis = new RedisCacheStore(throwingClient)
    const inv = await redis.inventory(1)
    assert.isTrue(inv.degraded)
    assert.equal(inv.storeKind, 'redis') // 仍是 redis，未冒泡
    const res = await redis.invalidateByScope(1, 'stage:a:')
    assert.isTrue(res.degraded)
  })
})

test.group('CacheStore - 单键热路径零行为变化回归（task 1.5）', () => {
  test('引入原语后 get/set/delete 命中/重算逐位等值（memory）', async ({ assert }) => {
    const mem = new MemoryCacheStore()
    await mem.set(1, 'k', 'v', 60)
    assert.equal(await mem.get(1, 'k'), 'v') // 命中
    assert.isNull(await mem.get(1, 'absent')) // 未命中
    await mem.delete(1, 'k')
    assert.isNull(await mem.get(1, 'k')) // 删除后未命中
  })

  test('引入原语后 get/set/delete 命中/重算逐位等值（redis 假客户端）', async ({ assert }) => {
    const redis = new RedisCacheStore(makeFakeRedis(() => Date.now()))
    await redis.set(1, 'k', 'v', 60)
    assert.equal(await redis.get(1, 'k'), 'v')
    assert.isNull(await redis.get(1, 'absent'))
    await redis.delete(1, 'k')
    assert.isNull(await redis.get(1, 'k'))
  })
})
