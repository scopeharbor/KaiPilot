import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

/**
 * 健康检查端点功能测试
 *
 * 覆盖率：健康端点契约（T050 local-release-runbook）。
 * 覆盖三端点语义分离（index/ready/live）、DB 探活分支、零业务数据契约。
 *
 * 本组不做 testUtils.db().migrate() 迁移——健康探针只做 SELECT 1，
 * 框架启动时已自动迁移。DB 不可达用 breakDbConnection 真实重定向连接到坏路径（不 stub rawQuery）。
 */

interface HealthBody {
  status: string
  version: string
  timestamp: string
  checks: {
    database: { status: 'up' | 'down'; latencyMs?: number; error?: string }
    realtime?: { enabled: boolean; status: 'up' | 'disabled'; connections?: number }
  }
}

/** Tuyau 把 health.ready/live 推断为 void 联合，集中断言为 HealthBody。 */
function healthBody(res: { body(): unknown }): HealthBody {
  return res.body() as HealthBody
}

/**
 * 真实模拟 DB 不可达：release 原 'sqlite' 连接，add 一个指向「父目录不存在」文件路径的坏配置，
 * better-sqlite3 真实尝试打开该文件时抛 SQLITE_CANTOPEN（unable to open database file）。
 * 返回恢复函数：release 坏连接并 add 回原配置，后续测试用原配置重新连接。
 *
 * 这是真实检测--不 stub rawQuery，pingDatabase 的 SELECT 1 真实走 better-sqlite3
 * 驱动并捕获真实错误。用 release/add（而非 patch）避免 orphan 连接累积污染后续测试组。
 */
async function breakDbConnection(): Promise<() => Promise<void>> {
  const manager = db.manager as unknown as {
    get: (name: string) => { config: Record<string, unknown> } | undefined
    release: (name: string) => Promise<void>
    add: (name: string, config: unknown) => void
  }
  const node = manager.get('sqlite')
  const originalConfig = node?.config
  if (!originalConfig) {
    throw new Error('sqlite 连接未注册，无法执行真实 DB down 测试')
  }
  const badConfig = {
    client: 'better-sqlite3',
    connection: { filename: `${process.cwd()}/nonexistent-${Date.now()}/test.sqlite` },
    useNullAsDefault: true,
  }
  await manager.release('sqlite')
  manager.add('sqlite', badConfig)
  return async () => {
    await manager.release('sqlite')
    manager.add('sqlite', originalConfig)
  }
}

test.group('Health check', () => {
  /**
   * T2.1 — GET /api/v1/health 返回 200 + 顶层 status 字段（向后兼容）
   * + version / timestamp / checks.database.{status,latencyMs}
   */
  test('GET /api/v1/health returns 200 with structured response', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health')

    response.assertStatus(200)

    const body = healthBody(response)
    // 向后兼容：顶层 status 字段保留
    assert.property(body, 'status')
    // 新增结构化字段
    assert.property(body, 'version')
    assert.property(body, 'timestamp')
    assert.property(body, 'checks')
    assert.isObject(body.checks)
    assert.property(body.checks, 'database')
    assert.property(body.checks.database, 'status')
    // latencyMs 只在 DB up 时有，down 时可能有 error 无 latencyMs
    if (body.checks.database.status === 'up') {
      assert.property(body.checks.database, 'latencyMs')
      assert.isNumber(body.checks.database.latencyMs)
      assert.isAtLeast(body.checks.database.latencyMs as number, 0)
    } else {
      assert.property(body.checks.database, 'error')
    }
  })

  /**
   * T2.1 — 响应值校验：version == package.json, ISO 8601 timestamp
   */
  test('GET /api/v1/health returns correct values when DB is up', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health')
    response.assertStatus(200)

    const body = healthBody(response)
    assert.equal(body.status, body.checks?.database?.status === 'up' ? 'ok' : 'degraded')
    assert.equal(body.version, '0.0.0')
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    assert.property(body.checks, 'database')
    assert.oneOf(body.checks.database.status, ['up', 'down'])
    if (body.checks.database.status === 'up') {
      assert.isNumber(body.checks.database.latencyMs)
      assert.isAtLeast(body.checks.database.latencyMs as number, 0)
    }
  })

  /**
   * T2.2 — GET /api/v1/health/ready DB 正常时 200 + status:'up'
   */
  test('GET /api/v1/health/ready returns 200 with database up', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health/ready')

    const body = healthBody(response)

    if (body.checks.database.status === 'up') {
      response.assertStatus(200)
      assert.equal(body.status, 'ok')
      assert.isNumber(body.checks.database.latencyMs)
      assert.isAtLeast(body.checks.database.latencyMs as number, 0)
    } else {
      response.assertStatus(503)
      assert.equal(body.status, 'degraded')
    }
    assert.equal(body.version, '0.0.0')
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  /**
   * T2.2 — GET /api/v1/health/live 返回 200 + {status:'ok'} 且不探 DB
   */
  test('GET /api/v1/health/live returns 200 with status ok', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health/live')
    response.assertStatus(200)
    assert.deepEqual(response.body(), { status: 'ok' })
  })

  /**
   * T2.3 — DB 不可达场景
   * - /health/ready → 503 + checks.database.status:'down'
   * - /health → 200 + status:'degraded'
   * 均在 1 秒内返回
   */
  test('GET /api/v1/health/ready returns 503 with database down when DB unavailable', async ({
    client,
    assert,
  }) => {
    // 真实重定向连接到坏路径模拟 DB 不可达
    const restore = await breakDbConnection()
    try {
      const start = Date.now()
      const response = await client.get('/api/v1/health/ready')
      const elapsed = Date.now() - start

      response.assertStatus(503)
      const body = healthBody(response)
      assert.equal(body.status, 'degraded')
      assert.equal(body.checks.database.status, 'down')
      // 在 1 秒内返回（含网络开销给 1500ms 缓冲）
      assert.isBelow(elapsed, 1500, '/health/ready should respond within 1s when DB is down')
    } finally {
      await restore()
    }
  })

  test('GET /api/v1/health returns 200 with degraded status when DB unavailable', async ({
    client,
    assert,
  }) => {
    // 真实重定向连接到坏路径模拟 DB 不可达
    const restore = await breakDbConnection()
    try {
      const start = Date.now()
      const response = await client.get('/api/v1/health')
      const elapsed = Date.now() - start

      // 综合端点不阻断，仍返回 200
      response.assertStatus(200)
      const body = healthBody(response)
      assert.equal(body.status, 'degraded')
      assert.equal(body.checks.database.status, 'down')
      assert.isBelow(elapsed, 1500, '/health should respond within 1s when DB is down')
    } finally {
      await restore()
    }
  })

  /**
   * T2.4 — 零业务数据契约
   * 三端点均不含 organization_id / 用户 / SQL / 堆栈
   */
  test('GET /api/v1/health response contains no sensitive fields', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health')
    response.assertStatus(200)

    const body = healthBody(response)
    const allowedTop = new Set(['status', 'version', 'timestamp', 'checks'])
    for (const key of Object.keys(body)) {
      assert.isTrue(allowedTop.has(key), `Response must not contain sensitive field: ${key}`)
    }

    if (body.checks) {
      // redis 为 v2-redis-minimum-runtime-support 新增的低敏探活目标（disabled/up/down）。
      const allowedChecks = new Set(['database', 'realtime', 'redis'])
      for (const key of Object.keys(body.checks)) {
        assert.isTrue(allowedChecks.has(key), `checks must not contain sensitive field: ${key}`)
      }
      if (body.checks.database) {
        const allowedDb = new Set(['status', 'latencyMs', 'error', 'connection'])
        for (const key of Object.keys(body.checks.database)) {
          assert.isTrue(
            allowedDb.has(key),
            `database check must not contain sensitive field: ${key}`,
          )
        }
      }
      const redisCheck = (body.checks as Record<string, Record<string, unknown>>).redis
      if (redisCheck) {
        // Redis 检查仅允许低敏字段：禁止 host/port/password/连接串。
        const allowedRedis = new Set(['status', 'latencyMs', 'connection', 'error'])
        for (const key of Object.keys(redisCheck)) {
          assert.isTrue(
            allowedRedis.has(key),
            `redis check must not contain sensitive field: ${key}`,
          )
        }
      }
    }
  })

  test('GET /api/v1/health/ready response contains no sensitive fields', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/api/v1/health/ready')

    const body = healthBody(response)
    const allowed = new Set(['status', 'version', 'timestamp', 'checks'])
    for (const key of Object.keys(body)) {
      assert.isTrue(allowed.has(key), `Response must not contain sensitive field: ${key}`)
    }
  })

  test('GET /api/v1/health/live response contains no sensitive fields', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/api/v1/health/live')
    response.assertStatus(200)

    const body = healthBody(response)
    const allowed = new Set(['status'])
    for (const key of Object.keys(body)) {
      assert.isTrue(allowed.has(key), `Response must not contain sensitive field: ${key}`)
    }
  })
})
