/**
 * v2-redis-minimum-runtime-support —— Redis 健康与就绪门禁功能测试（tasks 5.5）。
 *
 * 默认（Redis 未启用）路径：
 * - /api/v1/health 与 /ready 包含 checks.redis.status = 'disabled'
 * - Redis disabled 不拉低 ready（DB 正常时仍 200）
 * - 响应不暴露敏感字段（host/password/连接串）
 * - 就绪门禁在未启用时 ready（不阻断）
 *
 * Redis opt-in（REDIS_ENABLED=true）路径由独立 opt-in 分组覆盖，未启用时跳过。
 */
import { test } from '@japa/runner'

type HealthBody = {
  checks?: {
    redis?: { status?: string; latencyMs?: number; connection?: string; error?: string }
    database?: { status?: string }
  }
}

test.group('Redis 健康 - 默认未启用', () => {
  test('GET /api/v1/health 包含 checks.redis 且状态为 disabled', async ({ client, assert }) => {
    const res = await client.get('/api/v1/health')
    res.assertStatus(200)
    const redis = (res.body() as HealthBody).checks?.redis
    assert.exists(redis)
    assert.equal(redis!.status, 'disabled')
  })

  test('GET /api/v1/health/ready 在 Redis disabled 时仍返回 200（不拉低就绪）', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/v1/health/ready')
    res.assertStatus(200)
    const body = res.body() as HealthBody
    assert.equal(body.checks?.database?.status, 'up')
    assert.equal(body.checks?.redis?.status, 'disabled')
  })

  test('健康响应不暴露 Redis 敏感字段', async ({ client, assert }) => {
    const res = await client.get('/api/v1/health')
    const raw = JSON.stringify(res.body()).toLowerCase()
    for (const key of ['password', 'redis_password', '://', '6379']) {
      assert.notInclude(raw, key.toLowerCase())
    }
  })
})

test.group('Redis 就绪门禁 - 默认未启用', () => {
  test('未启用时门禁 ready 且不阻断', async ({ assert }) => {
    const { RedisReadinessGate } = await import('#services/redis/redis_readiness_gate')
    const result = await new RedisReadinessGate().check()
    assert.equal(result.status, 'ready')
    assert.equal(result.blockingCount, 0)
    assert.isFalse(result.enabled)
    assert.equal(result.connection, 'Redis (single-node)')
  })

  test('门禁报告不含敏感正文', async ({ assert }) => {
    const { RedisReadinessGate } = await import('#services/redis/redis_readiness_gate')
    const result = await new RedisReadinessGate().check()
    const raw = JSON.stringify(result).toLowerCase()
    assert.notInclude(raw, 'password')
    assert.notInclude(raw, '://')
  })
})

/**
 * Redis opt-in：仅当 REDIS_ENABLED=true 且 RUN_REDIS_TESTS=1 时执行。
 * 未启用或连接不可用时清晰跳过，禁止静默通过为已验证。
 */
const redisOptIn = process.env.REDIS_ENABLED === 'true' && process.env.RUN_REDIS_TESTS === '1'

const optInSkipReason = '未启用 Redis opt-in（设置 REDIS_ENABLED=true RUN_REDIS_TESTS=1 以运行）'

test.group('Redis 健康 - opt-in（需 REDIS_ENABLED=true RUN_REDIS_TESTS=1）', () => {
  test('启用可达时 /health 报告 redis up + latency', async ({ client, assert }) => {
    const res = await client.get('/api/v1/health')
    const redis = (res.body() as HealthBody).checks?.redis
    assert.exists(redis)
    assert.oneOf(redis!.status, ['up', 'down'])
    if (redis!.status === 'up') {
      assert.equal(redis!.connection, 'Redis (single-node)')
      assert.isNumber(redis!.latencyMs)
    }
  }).skip(!redisOptIn, optInSkipReason)

  test('启用可达时就绪门禁通过或明确阻断（连接不可用时不静默通过）', async ({ assert }) => {
    const { RedisReadinessGate } = await import('#services/redis/redis_readiness_gate')
    const result = await new RedisReadinessGate().check()
    assert.isTrue(result.enabled)
    assert.oneOf(result.status, ['ready', 'blocked', 'warning'])
  }).skip(!redisOptIn, optInSkipReason)
})
