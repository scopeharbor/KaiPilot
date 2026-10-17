// v3-multitenant-connection-pool-management §3 —— TenantConnectionPoolManager 核心测试。
//
// §3.2：成功 acquire/release、幂等 release、release 顺序、活跃计数清理。
// §3.4：单租户突增、全局耗尽、队列上限拒绝、隐藏原始 driver/provider 错误。
// §3.6：fake-clock 多租户公平性、队列等待顺序、deadline 过期、取消。
// §3.8：throw/timeout/abort/retry 耗尽/degraded/circuit-open 路径释放或拒绝 lease。
//
// 使用 FakePoolClock + TestPoolScheduler 保证确定性；不依赖真实 setTimeout。
import { test } from '@japa/runner'
import TenantConnectionPoolManager, {
  FakePoolClock,
  TestPoolScheduler,
  ConnectionPoolResourceNotRegisteredException,
  ConnectionPoolExhaustedException,
  ConnectionPoolTimeoutException,
  type TenantConnectionPoolManagerOptions,
} from '#services/tenant_connection_pool_manager'
import {
  type TcpmPoolMetricsLabel,
  type TcpmAcquireResult,
} from '@aiproj/types/multitenant-connection-pool-management'
import {
  buildOrgAContext,
  buildOrgBContext,
  MT_ORG_A_ID,
  MT_ORG_B_ID,
} from '@aiproj/types/multitenant-isolation-architecture-fixtures'
import type { TenantContext } from '@aiproj/types/multitenant-isolation-architecture'
import TenantConnectionPoolCatalog from '#services/tenant_connection_pool_catalog'

/** 构造带 TestMetricsSink 的 manager（收集 metrics label 供断言）。 */
function buildManager(initialClock = 0): {
  manager: TenantConnectionPoolManager
  clock: FakePoolClock
  metrics: TcpmPoolMetricsLabel[]
} {
  const clock = new FakePoolClock(initialClock)
  const metrics: TcpmPoolMetricsLabel[] = []
  const options: TenantConnectionPoolManagerOptions = {
    clock,
    scheduler: new TestPoolScheduler(),
    onMetrics: (label) => metrics.push(label),
  }
  return { manager: new TenantConnectionPoolManager(options), clock, metrics }
}

/** 构造 acquire 请求。 */
function acquireRequest(
  resourceKey: string,
  tenant: TenantContext,
  overrides?: Partial<{
    operationKind: string
    requestId: string
    idempotencyKey: string
    abortSignal: AbortSignal
    isSystemScope: boolean
  }>,
) {
  return {
    resourceKey,
    operationKind: overrides?.operationKind ?? 'read',
    tenant,
    requestId: overrides?.requestId ?? 'req-001',
    idempotencyKey: overrides?.idempotencyKey ?? 'idem-001',
    abortSignal: overrides?.abortSignal ?? null,
    isSystemScope: overrides?.isSystemScope,
  }
}

// ──────────────────────────────────────────────
// §3.2 acquire/release 基础 lifecycle
// ──────────────────────────────────────────────

test.group('PoolManager §3.2 acquire/release lifecycle', () => {
  test('成功 acquire 立即授予并返回 granted lease', async ({ assert }) => {
    const { manager, metrics } = buildManager()
    const result = await manager.acquire(acquireRequest('db:primary', buildOrgAContext()))
    assert.equal(result.decision, 'granted')
    assert.isNotNull(result.lease)
    assert.equal(result.lease!.resourceKey, 'db:primary')
    assert.equal(result.lease!.organizationId, MT_ORG_A_ID)
    assert.equal(manager.activeCount('db:primary'), 1)
    // granted 决策已发射 metrics
    assert.isTrue(metrics.some((m) => m.decision === 'granted' && m.resourceKey === 'db:primary'))
  })

  test('release 释放 lease 并清理活跃计数', async ({ assert }) => {
    const { manager, metrics } = buildManager()
    const { lease } = await manager.acquire(acquireRequest('db:primary', buildOrgAContext()))
    assert.equal(manager.activeCount('db:primary'), 1)
    manager.release(lease!)
    assert.equal(manager.activeCount('db:primary'), 0)
    assert.isTrue(metrics.some((m) => m.decision === 'released'))
  })

  test('release 幂等：同一 lease 多次 release 只减一次', async ({ assert }) => {
    const { manager } = buildManager()
    const { lease } = await manager.acquire(acquireRequest('db:primary', buildOrgAContext()))
    manager.release(lease!)
    manager.release(lease!) // 再次 release 不应使计数变负
    manager.release(lease!)
    assert.equal(manager.activeCount('db:primary'), 0)
  })

  test('release 未知 leaseId 安全忽略', async ({ assert }) => {
    const { manager } = buildManager()
    const fakeLease = {
      leaseId: 'nonexistent',
      resourceKey: 'db:primary',
      poolKind: 'database' as const,
      scopeHash: 'abc',
      organizationId: MT_ORG_A_ID,
      operationKind: 'read',
      requestId: 'req-x',
      idempotencyKey: null,
      grantedAt: 0,
      deadlineMs: 1000,
      degraded: false,
      queueWaitMs: 0,
    }
    assert.doesNotThrow(() => manager.release(fakeLease))
    assert.equal(manager.activeCount('db:primary'), 0)
  })

  test('不同 resource 独立计数', async ({ assert }) => {
    const { manager } = buildManager()
    const a = await manager.acquire(acquireRequest('db:primary', buildOrgAContext()))
    const b = await manager.acquire(acquireRequest('ai:gateway', buildOrgAContext()))
    assert.equal(manager.activeCount('db:primary'), 1)
    assert.equal(manager.activeCount('ai:gateway'), 1)
    manager.release(a.lease!)
    assert.equal(manager.activeCount('db:primary'), 0)
    assert.equal(manager.activeCount('ai:gateway'), 1)
    manager.release(b.lease!)
    assert.equal(manager.activeCount('ai:gateway'), 0)
  })
})

// ──────────────────────────────────────────────
// §3.4 单租户突增 / 全局耗尽 / 队列拒绝 / 隐藏原始错误
// ──────────────────────────────────────────────

test.group('PoolManager §3.4 burst / exhaustion / rejection', () => {
  test('单租户突增：超过 tenant limit 后入队，活跃不超过限额', async ({ assert }) => {
    // db:primary tenantLimit=5, globalLimit=10, queueLimit=20
    const { manager, clock } = buildManager()
    const tenant = buildOrgAContext()
    // 占满租户 5 个活跃
    const leases: TcpmAcquireResult[] = []
    for (let i = 0; i < 5; i++) {
      leases.push(
        await manager.acquire(acquireRequest('db:primary', tenant, { requestId: `r${i}` })),
      )
    }
    assert.equal(manager.activeCount('db:primary'), 5)
    // 第 6 个应入队（不立即 granted）
    const p6 = manager.acquire(acquireRequest('db:primary', tenant, { requestId: 'r6' }))
    const settled = await Promise.race([
      p6.then((r) => r),
      new Promise<TcpmAcquireResult>((res) =>
        setTimeout(() => res({ decision: 'queued', lease: null, queueWaitMs: 0 }), 50),
      ),
    ])
    assert.notEqual(settled.decision, 'granted')
    assert.equal(manager.queueLength('db:primary'), 1)
    // 释放一个后，队列中的应被授予
    manager.release(leases[0].lease!)
    // drain 是同步的（release 内调用）
    const r6 = await p6
    assert.equal(r6.decision, 'granted')
    void clock
  })

  test('队列上限满后 reject，不泄露其他租户状态', async ({ assert }) => {
    // db:primary queueLimit=20；占满租户活跃 5 + 队列 20
    const { manager } = buildManager()
    const tenant = buildOrgAContext()
    for (let i = 0; i < 5; i++) {
      await manager.acquire(acquireRequest('db:primary', tenant, { requestId: `a${i}` }))
    }
    // 填满队列 20
    const queued: Promise<TcpmAcquireResult>[] = []
    for (let i = 0; i < 20; i++) {
      queued.push(manager.acquire(acquireRequest('db:primary', tenant, { requestId: `q${i}` })))
    }
    assert.equal(manager.queueLength('db:primary'), 20)
    // 第 26 个应被 reject
    const rejected = await manager.acquire(
      acquireRequest('db:primary', tenant, { requestId: 'overflow' }),
    )
    assert.equal(rejected.decision, 'rejected')
    assert.equal(rejected.errorCode, 'CONNECTION_POOL_EXHAUSTED')
    assert.isNull(rejected.lease)
  })

  test('全局耗尽：多租户合计不超过 globalLimit', async ({ assert }) => {
    // db:primary globalLimit=10；组织 A 5 + 组织 B 5 = 10 满载
    const { manager } = buildManager()
    for (let i = 0; i < 5; i++) {
      await manager.acquire(
        acquireRequest('db:primary', buildOrgAContext(), { requestId: `a${i}` }),
      )
    }
    for (let i = 0; i < 5; i++) {
      await manager.acquire(
        acquireRequest('db:primary', buildOrgBContext(), { requestId: `b${i}` }),
      )
    }
    assert.equal(manager.activeCount('db:primary'), 10)
    // 组织 C（用新 org id）应入队（全局满）
    const orgC: TenantContext = { ...buildOrgAContext(), organizationId: 9999 }
    const p = manager.acquire(acquireRequest('db:primary', orgC, { requestId: 'c1' }))
    const race = await Promise.race([
      p.then((r) => r),
      new Promise<TcpmAcquireResult>((res) =>
        setTimeout(() => res({ decision: 'queued', lease: null, queueWaitMs: 0 }), 50),
      ),
    ])
    assert.notEqual(race.decision, 'granted')
  })

  test('未登记资源 fail closed：reject 并抛非泄露错误', async ({ assert }) => {
    const { manager } = buildManager()
    try {
      await manager.acquire(acquireRequest('unregistered:resource', buildOrgAContext()))
      assert.fail('应抛 ConnectionPoolResourceNotRegisteredException')
    } catch (e) {
      assert.instanceOf(e, ConnectionPoolResourceNotRegisteredException)
      const msg = (e as Error).message
      // 错误消息不含敏感信息，只含 resourceKey（已登记名）
      assert.notInclude(msg, 'password')
      assert.notInclude(msg, 'token')
    }
  })

  test('system scope 对默认禁止的资源被拒', async ({ assert }) => {
    const { manager } = buildManager()
    const sysTenant = {
      ...buildOrgAContext(),
      scopeMode: 'system_global' as const,
      isSuperAdmin: true,
    }
    const result = await manager.acquire(
      acquireRequest('db:primary', sysTenant, { isSystemScope: true }),
    )
    assert.equal(result.decision, 'rejected')
    assert.equal(result.errorCode, 'CONNECTION_POOL_SYSTEM_SCOPE_DENIED')
  })
})

// ──────────────────────────────────────────────
// §3.6 fake-clock 公平性 / 排队顺序 / deadline / 取消
// ──────────────────────────────────────────────

test.group('PoolManager §3.6 fairness / queue ordering / deadline / cancel', () => {
  test('多租户公平：组织 A 占满后，组织 B 的请求优先于组织 A 的后续请求', async ({ assert }) => {
    // db:primary tenantLimit=5, globalLimit=10
    const { manager } = buildManager()
    // 组织 A 占满 5 活跃
    const aLeases: TcpmAcquireResult[] = []
    for (let i = 0; i < 5; i++) {
      aLeases.push(
        await manager.acquire(
          acquireRequest('db:primary', buildOrgAContext(), { requestId: `a${i}` }),
        ),
      )
    }
    // 组织 A 再排 1 个（队列）
    const aExtraP = manager.acquire(
      acquireRequest('db:primary', buildOrgAContext(), { requestId: 'a-extra' }),
    )
    // 组织 B 排 1 个
    const bP = manager.acquire(
      acquireRequest('db:primary', buildOrgBContext(), { requestId: 'b1' }),
    )
    // 释放一个 A 活跃 → 公平策略应授予 B（B 活跃 0 < A 活跃 4）
    manager.release(aLeases[0].lease!)
    const bResult = await bP
    assert.equal(bResult.decision, 'granted')
    assert.equal(bResult.lease!.organizationId, MT_ORG_B_ID)
    // aExtra 仍在队列或被授予：release 后 A 活跃 4 < tenantLimit 5，drain 会继续授予 aExtra
    const aExtraResult = await Promise.race([
      aExtraP,
      new Promise<TcpmAcquireResult>((res) =>
        setTimeout(() => res({ decision: 'queued', lease: null, queueWaitMs: 0 }), 50),
      ),
    ])
    assert.equal(aExtraResult.decision, 'granted')
    assert.equal(aExtraResult.lease!.organizationId, MT_ORG_A_ID)
  })

  test('队列等待顺序：同租户按入队序号 FIFO', async ({ assert }) => {
    const { manager } = buildManager()
    const tenant = buildOrgAContext()
    // 占满活跃
    const held: TcpmAcquireResult[] = []
    for (let i = 0; i < 5; i++) {
      held.push(await manager.acquire(acquireRequest('db:primary', tenant, { requestId: `h${i}` })))
    }
    // 排队 3 个（同租户）
    const q1 = manager.acquire(acquireRequest('db:primary', tenant, { requestId: 'q1' }))
    const q2 = manager.acquire(acquireRequest('db:primary', tenant, { requestId: 'q2' }))
    const q3 = manager.acquire(acquireRequest('db:primary', tenant, { requestId: 'q3' }))
    // 释放一个 → 第一个入队的 q1 应先授予
    manager.release(held[0].lease!)
    const r1 = await q1
    assert.equal(r1.decision, 'granted')
    assert.equal(r1.lease!.requestId, 'q1')
    manager.release(held[1].lease!)
    const r2 = await q2
    assert.equal(r2.lease!.requestId, 'q2')
    void q3
  })

  test('deadline 过期：等待超过 acquireTimeout 返回 timeout，不占用 lease', async ({ assert }) => {
    // db:primary acquireTimeoutMs=5000
    const { manager, clock, metrics } = buildManager(0)
    const tenant = buildOrgAContext()
    // 占满活跃
    for (let i = 0; i < 5; i++) {
      await manager.acquire(acquireRequest('db:primary', tenant, { requestId: `h${i}` }))
    }
    // 排队一个
    const p = manager.acquire(acquireRequest('db:primary', tenant, { requestId: 'wait' }))
    assert.equal(manager.queueLength('db:primary'), 1)
    // 推进时间超过 acquireTimeout（5000）
    manager.tickForTest(5001)
    const result = await p
    assert.equal(result.decision, 'timeout')
    assert.equal(result.errorCode, 'CONNECTION_POOL_TIMEOUT')
    assert.isNull(result.lease)
    assert.equal(manager.queueLength('db:primary'), 0)
    assert.isTrue(metrics.some((m) => m.decision === 'timeout'))
    void clock
  })

  test('abort 取消：排队中 abort 返回 cancelled，不占用 lease', async ({ assert }) => {
    const { manager } = buildManager()
    const tenant = buildOrgAContext()
    for (let i = 0; i < 5; i++) {
      await manager.acquire(acquireRequest('db:primary', tenant, { requestId: `h${i}` }))
    }
    const controller = new AbortController()
    const p = manager.acquire(
      acquireRequest('db:primary', tenant, {
        requestId: 'abort-me',
        abortSignal: controller.signal,
      }),
    )
    assert.equal(manager.queueLength('db:primary'), 1)
    controller.abort()
    // purge 在 abort 事件中触发
    const result = await p
    assert.equal(result.decision, 'cancelled')
    assert.isNull(result.lease)
    assert.equal(manager.queueLength('db:primary'), 0)
  })
})

// ──────────────────────────────────────────────
// §3.8 throw / timeout / abort / retry / degraded / circuit-open 释放或拒绝
// ──────────────────────────────────────────────

test.group('PoolManager §3.8 failure paths release or reject lease', () => {
  test('wrapper throw 后 release(success=false) 累计 circuit 失败但不泄露', async ({ assert }) => {
    const { manager } = buildManager()
    const { lease } = await manager.acquire(acquireRequest('ai:gateway', buildOrgAContext()))
    // 模拟 wrapper 抛错后释放（success=false）
    assert.doesNotThrow(() => manager.release(lease!, { success: false }))
    assert.equal(manager.activeCount('ai:gateway'), 0)
  })

  test('连续失败触发 circuit open，后续 acquire 被拒绝', async ({ assert }) => {
    // ai:gateway circuitPolicy.failureThreshold=5
    const { manager, metrics } = buildManager()
    const tenant = buildOrgAContext()
    // 制造 5 次失败 release
    for (let i = 0; i < 5; i++) {
      const r = await manager.acquire(acquireRequest('ai:gateway', tenant, { requestId: `f${i}` }))
      manager.release(r.lease!, { success: false })
    }
    assert.equal(manager.circuitState('ai:gateway'), 'open')
    // 新请求应被 circuit_open 拒绝
    const rejected = await manager.acquire(
      acquireRequest('ai:gateway', tenant, { requestId: 'after-open' }),
    )
    assert.equal(rejected.decision, 'circuit_open')
    assert.equal(rejected.errorCode, 'CONNECTION_POOL_CIRCUIT_OPEN')
    assert.isTrue(metrics.some((m) => m.decision === 'circuit_open'))
  })

  test('circuit open 后经过 resetTimeout 转 half_open，探测成功恢复 closed', async ({ assert }) => {
    // ai:gateway resetTimeoutMs=30000
    const { manager, clock } = buildManager(0)
    const tenant = buildOrgAContext()
    for (let i = 0; i < 5; i++) {
      const r = await manager.acquire(acquireRequest('ai:gateway', tenant, { requestId: `f${i}` }))
      manager.release(r.lease!, { success: false })
    }
    assert.equal(manager.circuitState('ai:gateway'), 'open')
    // 推进时间超过 resetTimeout
    manager.tickForTest(30001)
    // 下一次 acquire 应触发 half_open 并授予探测 lease
    const probe = await manager.acquire(
      acquireRequest('ai:gateway', tenant, { requestId: 'probe' }),
    )
    assert.equal(probe.decision, 'granted')
    assert.equal(manager.circuitState('ai:gateway'), 'half_open')
    // 探测成功 → 恢复 closed
    manager.release(probe.lease!, { success: true })
    assert.equal(manager.circuitState('ai:gateway'), 'closed')
    void clock
  })

  test('retry 耗尽：wrapper 内部重试不重复 acquire，失败后单次 release', async ({ assert }) => {
    // 模拟 wrapper 重试逻辑：acquire 一次，内部重试 N 次都失败，最后 release(success=false) 一次
    const { manager } = buildManager()
    const { lease } = await manager.acquire(acquireRequest('kms:envelope', buildOrgAContext()))
    // 模拟内部重试耗尽（不重复 acquire）
    manager.release(lease!, { success: false })
    assert.equal(manager.activeCount('kms:envelope'), 0)
  })

  test('degraded：fallback_mode=degraded_local 的资源可降级授予（cache）', async ({ assert }) => {
    // cache:redis fallbackMode=degraded_local；本测试验证 acquire 仍正常授予 lease
    const { manager } = buildManager()
    const result = await manager.acquire(acquireRequest('cache:redis', buildOrgAContext()))
    assert.equal(result.decision, 'granted')
    assert.isNotNull(result.lease)
    manager.release(result.lease!)
  })

  test('timeout 路径不占用活跃 lease（排队超时后活跃数不变）', async ({ assert }) => {
    const { manager } = buildManager(0)
    const tenant = buildOrgAContext()
    for (let i = 0; i < 5; i++) {
      await manager.acquire(acquireRequest('db:primary', tenant, { requestId: `h${i}` }))
    }
    const beforeActive = manager.activeCount('db:primary')
    const p = manager.acquire(acquireRequest('db:primary', tenant, { requestId: 'timeout-me' }))
    manager.tickForTest(5001)
    const result = await p
    assert.equal(result.decision, 'timeout')
    assert.equal(manager.activeCount('db:primary'), beforeActive)
  })
})

// ──────────────────────────────────────────────
// 额外：metrics 低敏校验（与 §3.5/§4.5 交叉）
// ──────────────────────────────────────────────

test.group('PoolManager metrics 低敏', () => {
  test('所有发射的 metrics label 不含组织名/邮箱/token', async ({ assert }) => {
    const { manager, metrics } = buildManager()
    const { lease } = await manager.acquire(acquireRequest('ai:gateway', buildOrgAContext()))
    manager.release(lease!)
    for (const m of metrics) {
      assert.notProperty(m, 'organizationName')
      assert.notProperty(m, 'userEmail')
      assert.notProperty(m, 'token')
      assert.notProperty(m, 'authorization')
      assert.notProperty(m, 'connectionString')
      assert.notProperty(m, 'fullSql')
      assert.notProperty(m, 'prompt')
      assert.notProperty(m, 'otherTenantActive')
      assert.notProperty(m, 'globalActiveCount')
    }
  })

  test('metrics label 含 scopeHash 但不含 organizationId', async ({ assert }) => {
    const { manager, metrics } = buildManager()
    const { lease } = await manager.acquire(acquireRequest('db:primary', buildOrgAContext()))
    manager.release(lease!)
    const granted = metrics.find((m) => m.decision === 'granted')!
    assert.isTrue(granted.scopeHash.length > 0)
    assert.notProperty(granted, 'organizationId')
  })
})

// ──────────────────────────────────────────────
// §3.5 队列调度回归：多租户同时触顶且全局仍有余量时 drain 必须终止
// ──────────────────────────────────────────────

test.group('队列调度不死循环（§3.5 回归）', (group) => {
  group.each.setup(() => {
    // 让 globalLimit 远大于「活跃租户数 × tenantLimit」，制造原实现会空转的窗口
    process.env.DB_POOL_TENANT_LIMIT = '1'
    process.env.DB_POOL_GLOBAL_LIMIT = '50'
    TenantConnectionPoolCatalog.resetResolvedCacheForTest()
    return () => {
      delete process.env.DB_POOL_TENANT_LIMIT
      delete process.env.DB_POOL_GLOBAL_LIMIT
      TenantConnectionPoolCatalog.resetResolvedCacheForTest()
    }
  })

  test('三租户各自触顶时 release 能返回，且只授予释放方的排队请求', async ({ assert }) => {
    const { manager } = buildManager()
    const orgC: TenantContext = {
      organizationId: MT_ORG_A_ID + MT_ORG_B_ID + 1,
      projectId: null,
      scopeMode: 'organization_scoped',
      actorRef: 'user:3003',
      isSuperAdmin: false,
    }

    const a = await manager.acquire(
      acquireRequest('db:primary', buildOrgAContext(), { requestId: 'a1' }),
    )
    const b = await manager.acquire(
      acquireRequest('db:primary', buildOrgBContext(), { requestId: 'b1' }),
    )
    const c = await manager.acquire(acquireRequest('db:primary', orgC, { requestId: 'c1' }))
    assert.equal(a.decision, 'granted')
    assert.equal(b.decision, 'granted')
    assert.equal(c.decision, 'granted')

    // 三个租户各排一个（tenantLimit=1，全局仍有 47 个余量）
    const pa = manager.acquire(
      acquireRequest('db:primary', buildOrgAContext(), { requestId: 'a2' }),
    )
    const pb = manager.acquire(
      acquireRequest('db:primary', buildOrgBContext(), { requestId: 'b2' }),
    )
    const pc = manager.acquire(acquireRequest('db:primary', orgC, { requestId: 'c2' }))
    assert.equal(manager.queueLength('db:primary'), 3)

    // 原实现在这里会无限重选 B/C 的 waiter，release 永不返回
    manager.release(a.lease!)

    const ra = await pa
    assert.equal(ra.decision, 'granted')
    // B/C 仍触顶，必须留在队列里而不是被跳过后丢失
    assert.equal(manager.queueLength('db:primary'), 2)

    // 依次释放后 B、C 的排队请求也能拿到
    manager.release(b.lease!)
    const rb = await pb
    assert.equal(rb.decision, 'granted')
    manager.release(c.lease!)
    const rc = await pc
    assert.equal(rc.decision, 'granted')
    assert.equal(manager.queueLength('db:primary'), 0)
  })
})

// 导出异常类供其他测试引用
export {
  ConnectionPoolResourceNotRegisteredException,
  ConnectionPoolExhaustedException,
  ConnectionPoolTimeoutException,
}
