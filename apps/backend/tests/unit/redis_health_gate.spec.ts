/**
 * v2-redis-minimum-runtime-support —— 健康探活与就绪门禁纯逻辑单元测试（tasks 5.5）。
 *
 * 覆盖（无需 live Redis，走纯评估核心）：
 * - 健康三态 disabled / up / down
 * - 门禁通过（ready）
 * - 连接不可达阻断（blocked）
 * - 参数缺失阻断
 * - 敏感字段缺席（无 host/port/password/连接串/原始正文）
 */
import { test } from '@japa/runner'
import { buildRedisHealth } from '#services/redis/redis_health'
import { evaluateRedisGate } from '#services/redis/redis_readiness_gate'

test.group('Redis 健康 - 三态', () => {
  test('未启用 → disabled', ({ assert }) => {
    const r = buildRedisHealth(false, null)
    assert.equal(r.status, 'disabled')
    assert.isUndefined(r.connection)
    assert.isUndefined(r.error)
  })

  test('启用可达 → up + latency + 低敏连接', ({ assert }) => {
    const r = buildRedisHealth(true, { reachable: true, latencyMs: 3 })
    assert.equal(r.status, 'up')
    assert.equal(r.latencyMs, 3)
    assert.equal(r.connection, 'Redis (single-node)')
  })

  test('启用不可达 → down + 分类 error', ({ assert }) => {
    const r = buildRedisHealth(true, { reachable: false, error: 'connection_refused' })
    assert.equal(r.status, 'down')
    assert.equal(r.error, 'connection_refused')
    assert.isUndefined(r.connection)
  })

  test('健康结果不含敏感字段', ({ assert }) => {
    const up = buildRedisHealth(true, { reachable: true, latencyMs: 5 })
    const down = buildRedisHealth(true, { reachable: false, error: 'auth_failed' })
    for (const r of [up, down]) {
      const s = JSON.stringify(r).toLowerCase()
      assert.notInclude(s, 'password')
      assert.notInclude(s, '://')
      assert.notInclude(s, 'localhost')
      assert.notInclude(s, '6379')
    }
  })
})

test.group('Redis 就绪门禁 - 评估核心', () => {
  test('未启用 → ready（info REDIS_DISABLED，不阻断）', ({ assert }) => {
    const r = evaluateRedisGate({ enabled: false, missingParams: [], probe: null })
    assert.equal(r.status, 'ready')
    assert.equal(r.blockingCount, 0)
    assert.isTrue(r.issues.some((i) => i.code === 'REDIS_DISABLED'))
  })

  test('启用 + 参数缺失 → blocked（列出缺失名称）', ({ assert }) => {
    const r = evaluateRedisGate({
      enabled: true,
      missingParams: ['REDIS_HOST', 'REDIS_PORT'],
      probe: null,
    })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockingCount, 1)
    assert.isTrue(r.issues.some((i) => i.code === 'REDIS_PARAMS_MISSING'))
    assert.include(r.issues[0].message, 'REDIS_HOST')
  })

  test('启用 + 连接不可达 → blocked', ({ assert }) => {
    const r = evaluateRedisGate({
      enabled: true,
      missingParams: [],
      probe: { reachable: false, readWriteOk: false, error: 'connection_refused' },
    })
    assert.equal(r.status, 'blocked')
    assert.isTrue(r.issues.some((i) => i.code === 'REDIS_CONNECTION_UNREACHABLE'))
  })

  test('启用 + 可达但读写探针失败 → blocked', ({ assert }) => {
    const r = evaluateRedisGate({
      enabled: true,
      missingParams: [],
      probe: { reachable: true, latencyMs: 2, readWriteOk: false, error: 'unknown' },
    })
    assert.equal(r.status, 'blocked')
    assert.isTrue(r.issues.some((i) => i.code === 'REDIS_READWRITE_FAILED'))
  })

  test('启用 + 可达 + 读写通过 + 参数完整 → ready（通过）', ({ assert }) => {
    const r = evaluateRedisGate({
      enabled: true,
      missingParams: [],
      probe: { reachable: true, latencyMs: 2, readWriteOk: true },
    })
    assert.equal(r.status, 'ready')
    assert.equal(r.blockingCount, 0)
    assert.isTrue(r.details.connectionReachable)
    assert.isTrue(r.details.readWriteOk)
  })

  test('门禁报告不含敏感正文', ({ assert }) => {
    const r = evaluateRedisGate({
      enabled: true,
      missingParams: [],
      probe: { reachable: false, readWriteOk: false, error: 'auth_failed' },
    })
    const s = JSON.stringify(r).toLowerCase()
    assert.notInclude(s, 'password')
    assert.notInclude(s, '://')
    assert.notInclude(s, 'localhost')
    assert.notInclude(s, '6379')
  })
})
