/**
 * v2-redis-minimum-runtime-support —— Redis 可用性工厂（design D2, tasks 2.1-2.3）。
 *
 * 单一职责：决定「当前生效实现」是 Redis 还是内存。所有 Redis 消费者（限流器、缓存）
 * 都经此判定，不直接假设 Redis 可用。运行期 Redis 中断时回退内存，禁止 Redis 错误冒泡。
 *
 * 本模块保持纯逻辑（不 import Adonis redis 服务），便于单元测试；运行期可达性由
 * `markRedisReachable()` 注入（provider 启动探活与运行期错误更新）。
 */
import { isRedisEnabled } from '#config/redis'

export type EffectiveImplementation = 'redis' | 'memory'

/**
 * 运行期 Redis 可达性标记。默认 false —— 未探活成功前一律走内存，保证零外部依赖启动。
 */
let redisReachable = false

/** 标记 Redis 运行期可达性。provider 启动探活成功置 true；运行期中断置 false。 */
export function markRedisReachable(reachable: boolean): void {
  redisReachable = reachable
}

/** 读取当前运行期 Redis 可达性标记。 */
export function isRedisReachable(): boolean {
  return redisReachable
}

/** 测试辅助：重置可达性标记为初始（未可达）。 */
export function resetRedisReachableForTest(): void {
  redisReachable = false
}

export interface AvailabilityInputs {
  enabled: boolean
  reachable: boolean
}

/**
 * 纯函数：仅当「显式启用」且「当前可达」时返回 redis，否则内存。
 * 未启用、启用但从未连上、启用后运行期中断，均落到 memory。
 */
export function selectEffectiveImplementation(inputs: AvailabilityInputs): EffectiveImplementation {
  return inputs.enabled && inputs.reachable ? 'redis' : 'memory'
}

/**
 * 结合当前环境（是否启用）与运行期可达性，返回生效实现。
 * 消费者应在每次取用时调用，以便运行期中断后自动回退内存。
 */
export function getEffectiveImplementation(): EffectiveImplementation {
  return selectEffectiveImplementation({ enabled: isRedisEnabled(), reachable: redisReachable })
}
