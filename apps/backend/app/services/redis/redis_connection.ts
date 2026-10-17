/**
 * v2-redis-minimum-runtime-support —— Redis 连接探活与读写探针（design D2/D6, task 1.4）。
 *
 * 封装对 `@adonisjs/redis` 单节点 `main` 连接的低敏探活。所有异常内部消化并分类，
 * 禁止把 Redis 错误冒泡为面向用户的请求失败；探活结果同步更新运行期可达性标记，
 * 供可用性工厂在运行期中断后回退内存。
 *
 * Adonis redis 服务经 `redisService()` 惰性导入，避免在纯逻辑/未启用路径加载连接管理。
 */
import { classifyRedisError, type RedisErrorCategory } from './redis_error.js'
import { markRedisReachable } from './redis_availability.js'
import { REDIS_KEY_PREFIX } from '#config/redis'

export interface RedisPingResult {
  reachable: boolean
  latencyMs?: number
  error?: RedisErrorCategory
}

export interface RedisProbeResult extends RedisPingResult {
  /** SET/GET/DEL 读写探针是否通过（命名空间前缀下）。 */
  readWriteOk: boolean
}

/** 惰性获取 Adonis redis 服务的 `main` 连接。 */
async function mainConnection() {
  const { default: redis } = await import('@adonisjs/redis/services/main')
  return redis.connection('main')
}

/** 以 timeout 包裹 promise，超时抛出可被分类为 timeout 的错误。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis probe timeout')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * PING 探活。成功返回 { reachable:true, latencyMs }，失败返回 { reachable:false, error:<分类> }。
 * 副作用：更新运行期可达性标记（成功 true / 失败 false）。禁止抛出。
 */
export async function pingRedis(timeoutMs = 5000): Promise<RedisPingResult> {
  const start = Date.now()
  try {
    const conn = await mainConnection()
    await withTimeout(conn.ping(), timeoutMs)
    const latencyMs = Date.now() - start
    markRedisReachable(true)
    return { reachable: true, latencyMs }
  } catch (err) {
    markRedisReachable(false)
    return { reachable: false, error: classifyRedisError(err) }
  }
}

/**
 * 完整读写探针：PING + SET/GET/DEL 一次往返（命名空间前缀下）。
 * 供就绪门禁使用，验证连接可达且键空间可读写。禁止抛出、禁止残留探针键。
 */
export async function probeRedisReadWrite(timeoutMs = 5000): Promise<RedisProbeResult> {
  const ping = await pingRedis(timeoutMs)
  if (!ping.reachable) {
    return { ...ping, readWriteOk: false }
  }

  const probeKey = `${REDIS_KEY_PREFIX}__readiness_probe__`
  const probeVal = String(Date.now())
  try {
    const conn = await mainConnection()
    await withTimeout(conn.set(probeKey, probeVal, 'EX', 10), timeoutMs)
    const got = await withTimeout(conn.get(probeKey), timeoutMs)
    await withTimeout(conn.del(probeKey), timeoutMs)
    return { ...ping, readWriteOk: got === probeVal }
  } catch (err) {
    return {
      reachable: true,
      latencyMs: ping.latencyMs,
      error: classifyRedisError(err),
      readWriteOk: false,
    }
  }
}
