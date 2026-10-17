/**
 * v2-redis-minimum-runtime-support —— 缓存工厂（design D5, task 4.2）。
 *
 * 按 Redis 可用性返回「当前生效」CacheStore：可用→RedisCacheStore，否则→MemoryCacheStore。
 * 消费者调用 `resolveCacheStore()` 获取实现，运行期 Redis 中断后可用性工厂会回退内存，
 * 后续解析自动返回内存实现（不改变确定性结果，只影响是否命中共享缓存）。
 */
import {
  MemoryCacheStore,
  RedisCacheStore,
  type CacheStore,
  type RedisLikeClient,
} from './cache_store.js'
import { getEffectiveImplementation } from '#services/redis/redis_availability'

/**
 * 进程级内存实现单例：默认路径与降级路径共用，保证同进程缓存一致。
 */
const memoryStore = new MemoryCacheStore()

/** 惰性适配 Adonis redis `main` 连接到 RedisLikeClient（仅用到 get/set/del 子集 + v2-5 缓存管理的 scan/delKeys）。 */
async function redisClient(): Promise<RedisLikeClient> {
  const { default: redis } = await import('@adonisjs/redis/services/main')
  const conn = redis.connection('main')
  return {
    get: (key) => conn.get(key),
    set: (key, value, _mode, ttlSeconds) => conn.set(key, value, 'EX', ttlSeconds),
    del: (key) => conn.del(key),
    // v2-5-compiler-cache-management-api：SCAN 游标分批 + 多键 del（ioredis 兼容）。
    scan: (cursor, match, count) =>
      conn.scan(cursor, 'MATCH', match, 'COUNT', count) as Promise<[string, string[]]>,
    delKeys: (keys) => conn.del(...keys),
  }
}

/**
 * 解析当前生效 CacheStore。
 * Redis 生效时返回 RedisCacheStore（注入真实连接），否则返回共享内存实现。
 */
export async function resolveCacheStore(): Promise<CacheStore> {
  if (getEffectiveImplementation() === 'redis') {
    return new RedisCacheStore(await redisClient())
  }
  return memoryStore
}

/** 直接获取共享内存实现（默认路径快捷入口，无需 await 连接）。 */
export function memoryCacheStore(): CacheStore {
  return memoryStore
}
