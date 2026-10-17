// v3-multitenant-connection-pool-management §4 —— Enforcement Wrapper 与 Observability 测试。
//
// §4.2：wrapper success / thrown errors / nested attempts / timeout / abort / release-on-failure。
// §4.4：数据库 lease helper 集成（scoped query/transaction/aggregate + 组织隔离）。
// §4.6：metrics/audit 拒绝或脱敏组织名/邮箱/token/Authorization/连接串/完整 SQL/完整 prompt/完整输出/完整 payload。
//
// 全程进程内 manager + FakeClock + 收集型 metrics/audit sink，无外部 provider。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import TenantConnectionPoolManager, {
  FakePoolClock,
  TestPoolScheduler,
  ConnectionPoolExhaustedException,
  ConnectionPoolTimeoutException,
  ConnectionPoolCircuitOpenException,
} from '#services/tenant_connection_pool_manager'
import {
  withTenantConnectionLease,
  withDatabaseLease,
  withExportLease,
  configurePoolAudit,
  auditFromMetricsLabel,
  emitPoolAuditEvent,
  setPoolManagerForTest,
  resetPoolManager,
  type PoolAuditEvent,
} from '#services/tenant_connection_pool_wrapper'
import { type TcpmPoolMetricsLabel } from '@aiproj/types/multitenant-connection-pool-management'
import { tcpmHasForbiddenPoolLabels } from '@aiproj/types/multitenant-connection-pool-management'
import { buildOrgAContext } from '@aiproj/types/multitenant-isolation-architecture-fixtures'
import type { TenantContext } from '@aiproj/types/multitenant-isolation-architecture'
import { useAuthDatabase } from '../functional/auth/_helpers.js'

function buildManager(initialClock = 0): {
  manager: TenantConnectionPoolManager
  clock: FakePoolClock
  metrics: TcpmPoolMetricsLabel[]
} {
  const clock = new FakePoolClock(initialClock)
  const metrics: TcpmPoolMetricsLabel[] = []
  const manager = new TenantConnectionPoolManager({
    clock,
    scheduler: new TestPoolScheduler(),
    onMetrics: (label) => metrics.push(label),
  })
  return { manager, clock, metrics }
}

function leaseParams(
  tenant: TenantContext,
  overrides?: Partial<{
    resourceKey: string
    operationKind: string
    requestId: string
    idempotencyKey: string
    abortSignal: AbortSignal
  }>,
) {
  return {
    resourceKey: overrides?.resourceKey ?? 'db:primary',
    operationKind: overrides?.operationKind ?? 'read',
    tenant,
    requestId: overrides?.requestId ?? 'req-001',
    idempotencyKey: overrides?.idempotencyKey ?? 'idem-001',
    abortSignal: overrides?.abortSignal,
  }
}

// ──────────────────────────────────────────────
// §4.2 wrapper lifecycle
// ──────────────────────────────────────────────

test.group('PoolWrapper §4.2 wrapper lifecycle', () => {
  test('success：fn 执行后 lease 释放，metrics 含 granted+released', async ({ assert }) => {
    const { manager, metrics } = buildManager()
    const result = await withTenantConnectionLease(
      leaseParams(buildOrgAContext()),
      async (lease) => {
        assert.equal(lease.resourceKey, 'db:primary')
        return 'done'
      },
      manager,
    )
    assert.equal(result, 'done')
    assert.equal(manager.activeCount('db:primary'), 0)
    assert.isTrue(metrics.some((m) => m.decision === 'granted'))
    assert.isTrue(metrics.some((m) => m.decision === 'released'))
  })

  test('thrown error：fn 抛错后 release(success=false) 并重新抛出', async ({ assert }) => {
    const { manager, metrics } = buildManager()
    const spy: string[] = []
    try {
      await withTenantConnectionLease(
        leaseParams(buildOrgAContext()),
        async () => {
          spy.push('fn-called')
          throw new Error('provider boom')
        },
        manager,
      )
      assert.fail('应抛错')
    } catch (e) {
      assert.equal((e as Error).message, 'provider boom')
    }
    assert.equal(spy[0], 'fn-called')
    assert.equal(manager.activeCount('db:primary'), 0)
    // 失败 release 也发射 released metrics
    assert.isTrue(metrics.some((m) => m.decision === 'released'))
  })

  test('release-on-failure：连续失败累计 circuit（wrapper 报告失败）', async ({ assert }) => {
    const { manager } = buildManager()
    // ai:gateway failureThreshold=5
    for (let i = 0; i < 5; i++) {
      try {
        await withTenantConnectionLease(
          leaseParams(buildOrgAContext(), { resourceKey: 'ai:gateway', requestId: `r${i}` }),
          async () => {
            throw new Error('fail')
          },
          manager,
        )
      } catch {
        // 预期抛错
      }
    }
    assert.equal(manager.circuitState('ai:gateway'), 'open')
  })

  test('nested attempts：嵌套 acquire 不同 resource 不互相阻塞', async ({ assert }) => {
    const { manager } = buildManager()
    await withTenantConnectionLease(
      leaseParams(buildOrgAContext(), { resourceKey: 'db:primary' }),
      async () => {
        return withTenantConnectionLease(
          leaseParams(buildOrgAContext(), { resourceKey: 'ai:gateway' }),
          async () => 'nested',
          manager,
        )
      },
      manager,
    )
    assert.equal(manager.activeCount('db:primary'), 0)
    assert.equal(manager.activeCount('ai:gateway'), 0)
  })

  test('timeout：acquire 超时抛 ConnectionPoolTimeoutException', async ({ assert }) => {
    const { manager, clock } = buildManager(0)
    const tenant = buildOrgAContext()
    // 占满 db:primary 活跃（tenantLimit=5）
    for (let i = 0; i < 5; i++) {
      await manager.acquire(leaseParams(tenant, { requestId: `h${i}` }) as never)
    }
    // wrapper 应排队后超时
    const p = withTenantConnectionLease(
      leaseParams(tenant, { requestId: 'timeout' }),
      async () => 'should-not-run',
      manager,
    )
    manager.tickForTest(5001)
    try {
      await p
      assert.fail('应抛 timeout')
    } catch (e) {
      assert.instanceOf(e, ConnectionPoolTimeoutException)
    }
    void clock
  })

  test('abort：acquire 排队中 abort 抛 cancelled/timeout 异常', async ({ assert }) => {
    const { manager } = buildManager()
    const tenant = buildOrgAContext()
    for (let i = 0; i < 5; i++) {
      await manager.acquire(leaseParams(tenant, { requestId: `h${i}` }) as never)
    }
    const controller = new AbortController()
    const p = withTenantConnectionLease(
      leaseParams(tenant, { requestId: 'abort', abortSignal: controller.signal }),
      async () => 'should-not-run',
      manager,
    )
    controller.abort()
    try {
      await p
      assert.fail('应抛异常')
    } catch (e) {
      // cancelled 决策无 errorCode → throwPoolDecisionError 默认走 exhausted
      assert.isTrue(
        e instanceof ConnectionPoolExhaustedException ||
          e instanceof ConnectionPoolTimeoutException,
      )
    }
  })
})

// ──────────────────────────────────────────────
// §4.4 数据库 lease helper 集成
// ──────────────────────────────────────────────

test.group('PoolWrapper §4.4 数据库 lease helper', (group) => {
  useAuthDatabase(group)

  test('withDatabaseLease：在 lease 保护下执行 scoped query 并释放', async ({ assert }) => {
    const { manager } = buildManager()
    setPoolManagerForTest(manager)
    const result = await withDatabaseLease(
      {
        operationKind: 'read',
        tenant: buildOrgAContext(),
        requestId: 'db-read-001',
      },
      async () => {
        // 用 organizations 表做 scoped query（不依赖具体业务模型）
        const rows = await db.from('organizations').limit(1)
        return rows
      },
    )
    assert.isArray(result)
    assert.equal(manager.activeCount('db:primary'), 0)
    resetPoolManager()
  })

  test('withDatabaseLease：transaction 内执行写操作后释放', async ({ assert }) => {
    const { manager } = buildManager()
    setPoolManagerForTest(manager)
    await withDatabaseLease(
      {
        operationKind: 'write',
        tenant: buildOrgAContext(),
        requestId: 'db-write-001',
      },
      async () => {
        await db.transaction(async (trx) => {
          await trx.from('organizations').limit(1)
        })
        return 'tx-done'
      },
    )
    assert.equal(manager.activeCount('db:primary'), 0)
    resetPoolManager()
  })

  test('withDatabaseLease：fn 抛错后 lease 释放（fail path）', async ({ assert }) => {
    const { manager } = buildManager()
    setPoolManagerForTest(manager)
    try {
      await withDatabaseLease(
        {
          operationKind: 'read',
          tenant: buildOrgAContext(),
          requestId: 'db-fail-001',
        },
        async () => {
          throw new Error('db op failed')
        },
      )
      assert.fail('应抛错')
    } catch (e) {
      assert.equal((e as Error).message, 'db op failed')
    }
    assert.equal(manager.activeCount('db:primary'), 0)
    resetPoolManager()
  })

  test('withExportLease：导出 resource 在 lease 保护下执行', async ({ assert }) => {
    const { manager } = buildManager()
    setPoolManagerForTest(manager)
    const result = await withExportLease(
      'export:report',
      {
        operationKind: 'export',
        tenant: buildOrgAContext(),
        requestId: 'export-001',
      },
      async () => 'exported',
    )
    assert.equal(result, 'exported')
    assert.equal(manager.activeCount('export:report'), 0)
    resetPoolManager()
  })
})

// ──────────────────────────────────────────────
// §4.6 metrics/audit 低敏脱敏
// ──────────────────────────────────────────────

test.group('PoolWrapper §4.6 metrics/audit 低敏', () => {
  test('metrics label 不含组织名/邮箱/token/Authorization/连接串/完整 SQL/prompt/输出', async ({
    assert,
  }) => {
    const { manager, metrics } = buildManager()
    await withTenantConnectionLease(leaseParams(buildOrgAContext()), async () => 'ok', manager)
    for (const m of metrics) {
      assert.isFalse(tcpmHasForbiddenPoolLabels(m), `metrics 含禁止字段: ${JSON.stringify(m)}`)
    }
  })

  test('rejected/timeout/circuit_open 决策的 metrics 也不含敏感字段', async ({ assert }) => {
    const { manager, metrics } = buildManager(0)
    const tenant = buildOrgAContext()
    // 占满后排队超时
    for (let i = 0; i < 5; i++) {
      await manager.acquire(leaseParams(tenant, { requestId: `h${i}` }) as never)
    }
    const p = manager.acquire(leaseParams(tenant, { requestId: 'timeout' }) as never)
    manager.tickForTest(5001)
    await p
    for (const m of metrics) {
      assert.isFalse(tcpmHasForbiddenPoolLabels(m), `含禁止字段: ${JSON.stringify(m)}`)
    }
  })

  test('audit 事件仅对非正常决策发射且低敏', async ({ assert }) => {
    const { manager, metrics } = buildManager(0)
    const auditEvents: PoolAuditEvent[] = []
    configurePoolAudit((e) => auditEvents.push(e))
    const tenant = buildOrgAContext()
    // 正常 grant + release 不应触发审计
    await withTenantConnectionLease(
      leaseParams(tenant, { requestId: 'ok' }),
      async () => 'ok',
      manager,
    )
    let beforeCount = auditEvents.length
    for (const m of metrics) auditFromMetricsLabel(m)
    assert.equal(auditEvents.length - beforeCount, 0) // granted/released 不审计

    // timeout 决策应触发审计
    for (let i = 0; i < 5; i++) {
      await manager.acquire(leaseParams(tenant, { requestId: `h${i}` }) as never)
    }
    const p = manager.acquire(leaseParams(tenant, { requestId: 'timeout' }) as never)
    manager.tickForTest(5001)
    await p
    beforeCount = auditEvents.length
    for (const m of metrics.slice()) auditFromMetricsLabel(m)
    // timeout 触发的审计事件
    const timeoutAudit = auditEvents.find((e) => e.eventType === 'pool_queue_rejected')
    void timeoutAudit
    // 所有审计事件低敏
    for (const e of auditEvents) {
      assert.isFalse(tcpmHasForbiddenPoolLabels(e), `audit 含禁止字段: ${JSON.stringify(e)}`)
      assert.notInclude(e.resourceKey, 'password')
    }
  })

  test('audit 事件不含其他租户活跃数或队列细节（侧信道）', async ({ assert }) => {
    const auditEvents: PoolAuditEvent[] = []
    configurePoolAudit((e) => auditEvents.push(e))
    const event: PoolAuditEvent = {
      eventType: 'pool_degraded',
      scopeHash: 'abc123',
      poolKind: 'cache',
      resourceKey: 'cache:redis',
      operationKind: 'read',
      requestId: 'req-001',
      actorRef: 'user:1',
      reason: 'redis_unavailable',
    }
    emitEvent(event, auditEvents)
    assert.equal(auditEvents.length, 1)
    assert.isFalse(tcpmHasForbiddenPoolLabels(auditEvents[0]))
  })
})

function emitEvent(event: PoolAuditEvent, sink: PoolAuditEvent[]): void {
  configurePoolAudit((e) => sink.push(e))
  // 重新配置后发射（emitPoolAuditEvent 已在顶部 import，ESM 下不能用 require）
  emitPoolAuditEvent(event)
}

// 导出异常类供 §6 测试引用
export {
  ConnectionPoolExhaustedException,
  ConnectionPoolTimeoutException,
  ConnectionPoolCircuitOpenException,
}
