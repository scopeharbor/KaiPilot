/**
 * v2-redis-minimum-runtime-support —— Redis 健康探活（design D6, tasks 5.1-5.2）。
 *
 * 三态：
 * - disabled: Redis 未启用（默认）。不拉低整体就绪。
 * - up: 启用且可达。返回 latencyMs 与低敏连接标识。
 * - down: 启用但探活失败。返回分类 error。
 *
 * 复用 HealthController.pingDatabase 的低敏范式：禁止 host/port/password/连接串/原始异常正文。
 */
import { isRedisEnabled, redisLowSensitiveDescription } from '#config/redis'
import { pingRedis, type RedisPingResult } from './redis_connection.js'
import type { RedisErrorCategory } from './redis_error.js'

export interface RedisHealthResult {
  status: 'disabled' | 'up' | 'down'
  latencyMs?: number
  connection?: string
  error?: RedisErrorCategory
}

/**
 * 纯映射：由「是否启用」与 PING 结果构造三态健康结果。
 * 无副作用、无 I/O，便于单元测试全部分支（disabled/up/down）而无需 live Redis。
 * up 仅暴露 latencyMs 与低敏连接标识；down 仅暴露分类 error——禁止 host/password/连接串。
 */
export function buildRedisHealth(
  enabled: boolean,
  ping: RedisPingResult | null,
): RedisHealthResult {
  if (!enabled || ping === null) {
    return { status: 'disabled' }
  }
  if (ping.reachable) {
    return {
      status: 'up',
      latencyMs: ping.latencyMs,
      connection: redisLowSensitiveDescription(),
    }
  }
  return { status: 'down', error: ping.error }
}

/**
 * 探活 Redis。未启用直接返回 disabled，不建立连接。
 */
export async function checkRedisHealth(timeoutMs = 5000): Promise<RedisHealthResult> {
  const enabled = isRedisEnabled()
  if (!enabled) {
    return buildRedisHealth(false, null)
  }

  const ping = await pingRedis(timeoutMs)
  return buildRedisHealth(true, ping)
}
