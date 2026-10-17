/**
 * v2-redis-minimum-runtime-support —— 优雅降级与可用性工厂单元测试（tasks 2.3）。
 *
 * 覆盖：
 * - 未启用走内存
 * - 启用且可达走 Redis
 * - 运行期不可达回退内存（不崩溃）
 */
import { test } from '@japa/runner'

test.group('Redis 可用性工厂 - selectEffectiveImplementation', () => {
  test('未启用 → memory', async ({ assert }) => {
    const { selectEffectiveImplementation } = await import('#services/redis/redis_availability')
    assert.equal(selectEffectiveImplementation({ enabled: false, reachable: false }), 'memory')
    assert.equal(selectEffectiveImplementation({ enabled: false, reachable: true }), 'memory')
  })

  test('启用且可达 → redis', async ({ assert }) => {
    const { selectEffectiveImplementation } = await import('#services/redis/redis_availability')
    assert.equal(selectEffectiveImplementation({ enabled: true, reachable: true }), 'redis')
  })

  test('启用但不可达 → memory（降级）', async ({ assert }) => {
    const { selectEffectiveImplementation } = await import('#services/redis/redis_availability')
    assert.equal(selectEffectiveImplementation({ enabled: true, reachable: false }), 'memory')
  })
})

test.group('Redis 可用性工厂 - 运行期可达性标记', () => {
  test('默认未可达；标记可达后再中断回退', async ({ assert }) => {
    const mod = await import('#services/redis/redis_availability')
    mod.resetRedisReachableForTest()
    assert.isFalse(mod.isRedisReachable())

    mod.markRedisReachable(true)
    assert.isTrue(mod.isRedisReachable())

    // 模拟运行期 Redis 中断
    mod.markRedisReachable(false)
    assert.isFalse(mod.isRedisReachable())

    mod.resetRedisReachableForTest()
  })

  test('getEffectiveImplementation 在未启用环境恒为 memory（默认零外部依赖）', async ({
    assert,
  }) => {
    const mod = await import('#services/redis/redis_availability')
    mod.resetRedisReachableForTest()
    // 测试进程 REDIS_ENABLED 未设 → 恒 memory，即便可达标记被置 true
    mod.markRedisReachable(true)
    assert.equal(mod.getEffectiveImplementation(), 'memory')
    mod.resetRedisReachableForTest()
  })
})
