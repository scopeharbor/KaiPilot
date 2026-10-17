/**
 * v2-redis-minimum-runtime-support —— 限流器 store 策略单元测试（tasks 3.4）。
 *
 * 覆盖：
 * - 默认/显式 memory → memory
 * - redis opt-in（Redis 启用）→ redis
 * - redis 选项但 Redis 未启用 → 抛错（禁止静默回退）
 *
 * SEC-03/SEC-10 跨进程/跨重启状态断言仅在 Redis opt-in 测试（RUN_REDIS_TESTS）执行，
 * 本文件只覆盖 store 选择与启动校验的纯逻辑。
 */
import { test } from '@japa/runner'

test.group('限流器 store 策略', () => {
  test('memory（默认）→ memory', async ({ assert }) => {
    const { resolveLimiterStore } = await import('#services/redis/limiter_store_policy')
    assert.equal(resolveLimiterStore('memory', false), 'memory')
    assert.equal(resolveLimiterStore('memory', true), 'memory')
  })

  test('redis 且 Redis 启用 → redis（opt-in）', async ({ assert }) => {
    const { resolveLimiterStore } = await import('#services/redis/limiter_store_policy')
    assert.equal(resolveLimiterStore('redis', true), 'redis')
  })

  test('redis 但 Redis 未启用 → 抛错，禁止静默回退', async ({ assert }) => {
    const { resolveLimiterStore } = await import('#services/redis/limiter_store_policy')
    assert.throws(() => resolveLimiterStore('redis', false), /REDIS_ENABLED/)
  })

  test('抛出的错误不含任何密钥/密码', async ({ assert }) => {
    const { resolveLimiterStore } = await import('#services/redis/limiter_store_policy')
    try {
      resolveLimiterStore('redis', false)
      assert.fail('应当抛错')
    } catch (err) {
      const msg = (err as Error).message.toLowerCase()
      assert.notInclude(msg, 'password')
      assert.notInclude(msg, '://')
    }
  })
})
