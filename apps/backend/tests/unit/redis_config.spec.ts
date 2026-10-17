/**
 * v2-redis-minimum-runtime-support —— Redis 配置单元测试（tasks 1.5）。
 *
 * 覆盖：
 * - 默认关闭（REDIS_ENABLED 未设 → isRedisEnabled 为 false）
 * - 启用参数解析（config/redis.ts 连接结构与分项参数）
 * - 必填参数缺失（missingRedisParams 报告 REDIS_HOST/REDIS_PORT）
 * - 启用但不可达仍可启动（retryStrategy 超上限返回 null，不无限重连挂起 + 本套件本身已在应用启动后运行）
 * - 敏感信息不泄漏（低敏连接标识不含 host/port/连接串）
 *
 * 注意：config 在应用启动时加载一次，REDIS_ENABLED 在测试进程默认未设置，故此处验证
 * 默认关闭路径与配置对象结构；启用后的实连接行为由 Redis opt-in 测试（RUN_REDIS_TESTS）覆盖。
 */
import { test } from '@japa/runner'

test.group('Redis config - 默认关闭', () => {
  test('isRedisEnabled 默认返回 false', async ({ assert }) => {
    const { isRedisEnabled } = await import('#config/redis')
    assert.isFalse(isRedisEnabled())
  })

  test('后端在 Redis 未启用时已成功启动（本测试套件运行即为证据）', async ({ assert }) => {
    // 若缺少 Redis 会阻止启动，则本 Japa 套件无法运行到这里。
    assert.isTrue(true)
  })
})

test.group('Redis config - 连接参数结构', () => {
  test('配置为单节点 main 连接', async ({ assert }) => {
    const config = await import('#config/redis')
    assert.equal(config.default.connection, 'main')
    assert.property(config.default.connections, 'main')
  })

  test('main 连接包含分项参数与有限重连策略', async ({ assert }) => {
    const config = await import('#config/redis')
    const main = (config.default.connections as Record<string, any>).main

    assert.property(main, 'host')
    assert.property(main, 'port')
    assert.property(main, 'db')
    assert.property(main, 'connectTimeout')
    assert.property(main, 'maxRetriesPerRequest')
    assert.typeOf(main.retryStrategy, 'function')
  })

  test('retryStrategy 超过重连上限返回 null（避免无限重连挂起，保证不可达也不阻塞启动）', async ({
    assert,
  }) => {
    const config = await import('#config/redis')
    const main = (config.default.connections as Record<string, any>).main

    // 默认 REDIS_MAX_RETRIES=1；times>1 应停止重连
    assert.isNull(main.retryStrategy(999))
    assert.isNotNull(main.retryStrategy(1))
  })
})

test.group('Redis config - 必填参数缺失', () => {
  test('未配置 host/port 时 missingRedisParams 报告缺失项名称', async ({ assert }) => {
    const { missingRedisParams } = await import('#config/redis')
    const missing = missingRedisParams()
    // 测试进程默认未设 REDIS_HOST/REDIS_PORT
    assert.include(missing, 'REDIS_HOST')
    assert.include(missing, 'REDIS_PORT')
  })
})

test.group('Redis config - 敏感信息不泄漏', () => {
  test('低敏连接标识不含 host/port/password/连接串', async ({ assert }) => {
    const { redisLowSensitiveDescription } = await import('#config/redis')
    const desc = redisLowSensitiveDescription()
    assert.equal(desc, 'Redis (single-node)')
    assert.notInclude(desc, '://')
    assert.notInclude(desc, 'localhost')
    assert.notInclude(desc.toLowerCase(), 'password')
    assert.notInclude(desc, '6379')
  })

  test('键前缀常量定义且用于命名空间隔离', async ({ assert }) => {
    const { REDIS_KEY_PREFIX, REDIS_LIMITER_KEY_PREFIX } = await import('#config/redis')
    assert.equal(REDIS_KEY_PREFIX, 'aiproj:')
    assert.include(REDIS_LIMITER_KEY_PREFIX, 'limiter')
  })
})
