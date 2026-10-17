// v3-multitenant-connection-pool-management §2.4/§2.6 —— 连接资源 catalog 完整性与 budget override 测试。
//
// §2.4：catalog 完整性——高风险资源缺 entry/fixture/budget/timeout/fallback/metrics 即失败。
// §2.6：budget override 解析、非法 env 回落、SQLite 本机运行兼容。
import { test } from '@japa/runner'
import TenantConnectionPoolCatalog, {
  applyEnvOverrides,
} from '#services/tenant_connection_pool_catalog'
import {
  TCPM_POOL_KINDS,
  isTcpmPoolKind,
  isTcpmFallbackMode,
  isTcpmMetricsLabelPolicy,
  tcpmResolveBudget,
  type TcpmConnectionPoolCatalogEntry,
} from '@aiproj/types/multitenant-connection-pool-management'
import { buildOrgAContext } from '@aiproj/types/multitenant-isolation-architecture-fixtures'

/** 全部高风险 pool kind（排除 local-only） */
const HIGH_RISK_POOL_KINDS = TCPM_POOL_KINDS.filter((k) => k !== 'local-only')

test.group('连接资源 catalog 完整性（§2.4）', () => {
  test('catalog validate 通过：全部 entry 声明完整', ({ assert }) => {
    assert.doesNotThrow(() => TenantConnectionPoolCatalog.validate())
  })

  test('catalog 覆盖全部高风险 pool kind', ({ assert }) => {
    const coveredKinds = new Set(TenantConnectionPoolCatalog.all().map((e) => e.poolKind))
    for (const kind of HIGH_RISK_POOL_KINDS) {
      assert.isTrue(coveredKinds.has(kind), `缺少 pool kind: ${kind}`)
    }
  })

  test('每个高风险 entry 具备 fixture/budget/timeout/fallback/metrics policy', ({ assert }) => {
    for (const entry of TenantConnectionPoolCatalog.highRiskEntries()) {
      assert.isTrue(entry.fixtureName.length > 0, `${entry.resourceKey} 缺 fixtureName`)
      assert.isTrue(entry.globalLimit > 0, `${entry.resourceKey} globalLimit 必须 > 0`)
      assert.isTrue(
        entry.defaultTenantLimit > 0,
        `${entry.resourceKey} defaultTenantLimit 必须 > 0`,
      )
      assert.isTrue(entry.queueLimit >= 0, `${entry.resourceKey} queueLimit 必须 >= 0`)
      assert.isTrue(entry.acquireTimeoutMs > 0, `${entry.resourceKey} acquireTimeoutMs 必须 > 0`)
      assert.isTrue(
        entry.operationTimeoutMs > 0,
        `${entry.resourceKey} operationTimeoutMs 必须 > 0`,
      )
      assert.isTrue(
        isTcpmFallbackMode(entry.fallbackMode),
        `${entry.resourceKey} fallbackMode 非法`,
      )
      assert.isTrue(
        isTcpmMetricsLabelPolicy(entry.metricsLabelPolicy),
        `${entry.resourceKey} metricsLabelPolicy 非法`,
      )
      assert.isTrue(isTcpmPoolKind(entry.poolKind), `${entry.resourceKey} poolKind 非法`)
    }
  })

  test('catalog 资源键唯一', ({ assert }) => {
    const keys = TenantConnectionPoolCatalog.all().map((e) => e.resourceKey)
    assert.equal(new Set(keys).size, keys.length)
  })

  test('高风险 entry 默认 systemScopeAllowed=false（system maintenance 须显式 opt-in）', ({
    assert,
  }) => {
    for (const entry of TenantConnectionPoolCatalog.highRiskEntries()) {
      assert.isFalse(entry.systemScopeAllowed, `${entry.resourceKey} 默认应禁止 system scope`)
    }
  })

  test('未登记资源键 fail closed：get 抛错', ({ assert }) => {
    assert.throws(() => TenantConnectionPoolCatalog.get('unregistered:resource'))
  })

  test('未登记资源键 has 返回 false', ({ assert }) => {
    assert.isFalse(TenantConnectionPoolCatalog.has('unregistered:resource'))
  })

  test('catalog 覆盖 observation inventory §4 的全部高风险资源', ({ assert }) => {
    const requiredKeys = [
      'db:primary',
      'cache:redis',
      'ai:gateway',
      'ai:draft',
      'ocr:provider',
      'kms:envelope',
      'dlp:engine',
      'watermark:renderer',
      'compliance:evaluator',
      'compiler:run',
      'compiler:artifact',
      'export:report',
      'export:ocr_privacy',
      'report:job',
      'job:worker',
      'integration:webhook',
    ]
    for (const key of requiredKeys) {
      assert.isTrue(TenantConnectionPoolCatalog.has(key), `缺少高风险资源: ${key}`)
    }
    // 反向断言：catalog 的高风险 entry 不得多于 inventory §4（防止悄悄新增未登记资源）
    const highRisk = TenantConnectionPoolCatalog.highRiskEntries().map((e) => e.resourceKey)
    assert.sameMembers(highRisk, requiredKeys)
  })

  test('仅 diagnostics:pool_health 显式允许 system maintenance scope', ({ assert }) => {
    const allowed = TenantConnectionPoolCatalog.all()
      .filter((e) => e.systemScopeAllowed)
      .map((e) => e.resourceKey)
    assert.deepEqual(allowed, ['diagnostics:pool_health'])
    // 允许项必须是低敏聚合诊断，不得是业务连接资源
    const diag = TenantConnectionPoolCatalog.get('diagnostics:pool_health')
    assert.equal(diag.poolKind, 'local-only')
    assert.equal(diag.metricsLabelPolicy, 'minimal')
  })

  test('local-only 资源登记但不强制 lease（queueLimit 可为 0）', ({ assert }) => {
    const localOnly = TenantConnectionPoolCatalog.byPoolKind('local-only')
    assert.isTrue(localOnly.length >= 1)
    for (const entry of localOnly) {
      assert.equal(entry.poolKind, 'local-only')
    }
  })

  test('retry/circuit policy 字段合法', ({ assert }) => {
    for (const entry of TenantConnectionPoolCatalog.all()) {
      assert.isTrue(entry.retryPolicy.maxRetries >= 0)
      assert.isTrue(entry.retryPolicy.initialBackoffMs > 0)
      assert.isTrue(entry.retryPolicy.backoffMultiplier > 0)
      assert.isTrue(entry.retryPolicy.maxBackoffMs > 0)
      assert.isTrue(entry.circuitPolicy.failureThreshold > 0)
      assert.isTrue(entry.circuitPolicy.resetTimeoutMs > 0)
      assert.isTrue(entry.circuitPolicy.halfOpenProbeLimit > 0)
    }
  })
})

test.group('budget override 解析（§2.5/§2.6）', (group) => {
  // 每个测试前清 env override 缓存，确保隔离
  group.each.setup(() => {
    TenantConnectionPoolCatalog.resetResolvedCacheForTest()
    return () => {
      // 清理测试设置的 env
      delete process.env.DB_POOL_TENANT_LIMIT
      delete process.env.DB_POOL_GLOBAL_LIMIT
      delete process.env.DB_POOL_QUEUE_LIMIT
      delete process.env.AI_POOL_TENANT_LIMIT
      delete process.env.CACHE_POOL_TENANT_LIMIT
      TenantConnectionPoolCatalog.resetResolvedCacheForTest()
    }
  })

  test('合法 env override 覆盖 catalog 默认 budget', ({ assert }) => {
    process.env.DB_POOL_TENANT_LIMIT = '99'
    process.env.DB_POOL_GLOBAL_LIMIT = '100'
    process.env.DB_POOL_QUEUE_LIMIT = '50'
    TenantConnectionPoolCatalog.resetResolvedCacheForTest()

    const entry = TenantConnectionPoolCatalog.get('db:primary')
    assert.equal(entry.defaultTenantLimit, 99)
    assert.equal(entry.globalLimit, 100)
    assert.equal(entry.queueLimit, 50)

    // budget 解析也使用 override 后的值
    const budget = tcpmResolveBudget(entry, buildOrgAContext())
    assert.equal(budget.tenantLimit, 99)
    assert.equal(budget.globalLimit, 100)
  })

  test('非法 env 值回落 catalog 默认值（不抛错）', ({ assert }) => {
    process.env.DB_POOL_TENANT_LIMIT = 'not-a-number'
    process.env.DB_POOL_GLOBAL_LIMIT = '-5'
    TenantConnectionPoolCatalog.resetResolvedCacheForTest()

    const base = TenantConnectionPoolCatalog.getBase('db:primary')
    const entry = TenantConnectionPoolCatalog.get('db:primary')
    assert.equal(entry.defaultTenantLimit, base.defaultTenantLimit)
    assert.equal(entry.globalLimit, base.globalLimit)
  })

  test('env override 值为 0 时回落默认值（limit 不允许 0）', ({ assert }) => {
    process.env.DB_POOL_TENANT_LIMIT = '0'
    TenantConnectionPoolCatalog.resetResolvedCacheForTest()

    const base = TenantConnectionPoolCatalog.getBase('db:primary')
    const entry = TenantConnectionPoolCatalog.get('db:primary')
    assert.equal(entry.defaultTenantLimit, base.defaultTenantLimit)
  })

  test('未设 env 时使用 catalog 默认 budget', ({ assert }) => {
    const entry = TenantConnectionPoolCatalog.get('db:primary')
    const base = TenantConnectionPoolCatalog.getBase('db:primary')
    assert.equal(entry.defaultTenantLimit, base.defaultTenantLimit)
    assert.equal(entry.globalLimit, base.globalLimit)
    assert.equal(entry.queueLimit, base.queueLimit)
  })

  test('SQLite 本机运行兼容：db:primary 不依赖 PG/Redis 参数', ({ assert }) => {
    // SQLite 本机默认连接，catalog 不应要求 PG_POOL/REDIS 参数
    const entry = TenantConnectionPoolCatalog.get('db:primary')
    assert.equal(entry.poolKind, 'database')
    assert.notMatch(entry.adapterName, /pg|postgres/i)
    // budget 可在无 Redis 时解析
    const budget = tcpmResolveBudget(entry, buildOrgAContext())
    assert.isAbove(budget.tenantLimit, 0)
    assert.isAbove(budget.globalLimit, 0)
  })

  test('applyEnvOverrides 对无 prefix 的 entry 不改动', ({ assert }) => {
    const noPrefixEntry: TcpmConnectionPoolCatalogEntry = {
      resourceKey: 'test:no-prefix',
      poolKind: 'provider',
      adapterName: 'test',
      globalLimit: 5,
      defaultTenantLimit: 2,
      queueLimit: 4,
      acquireTimeoutMs: 1000,
      operationTimeoutMs: 5000,
      retryPolicy: { maxRetries: 1, initialBackoffMs: 50, backoffMultiplier: 2, maxBackoffMs: 500 },
      circuitPolicy: { failureThreshold: 3, resetTimeoutMs: 10000, halfOpenProbeLimit: 1 },
      fallbackMode: 'fail_closed',
      systemScopeAllowed: false,
      metricsLabelPolicy: 'low_sensitive',
      fixtureName: 'test-fixture',
    }
    const applied = applyEnvOverrides(noPrefixEntry)
    assert.equal(applied.defaultTenantLimit, noPrefixEntry.defaultTenantLimit)
    assert.equal(applied.globalLimit, noPrefixEntry.globalLimit)
  })

  test('cache entry fallbackMode=degraded_local（no-Redis 可降级）', ({ assert }) => {
    const cache = TenantConnectionPoolCatalog.get('cache:redis')
    assert.equal(cache.fallbackMode, 'degraded_local')
  })
})
