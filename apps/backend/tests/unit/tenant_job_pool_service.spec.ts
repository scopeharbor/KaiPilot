// v3-multitenant-connection-pool-management §6.1-§6.4 —— 后台作业连接治理测试。
//
// §6.2：入队元数据含低敏租户快照/requestId/幂等键/pool resource keys/权限快照 hash，
//       且不含 raw JWT、secret、provider payload 或完整用户身份。
// §6.4：worker 执行的 stale / revoked / 跨租户 / 取消 / 重试 / 超时 / resume lease 行为。
//
// 全程进程内 manager + FakeClock，无真实外部 provider、无真实作业副作用。
import { test } from '@japa/runner'
import TenantJobPoolService, { JOB_WORKER_RESOURCE_KEY } from '#services/tenant_job_pool_service'
import TenantConnectionPoolManager, {
  FakePoolClock,
  TestPoolScheduler,
  ConnectionPoolTimeoutException,
} from '#services/tenant_connection_pool_manager'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type { TcpmJobPoolMetadata } from '@aiproj/types/multitenant-connection-pool-management'
import {
  buildOrgAContext,
  buildOrgBContext,
} from '@aiproj/types/multitenant-isolation-architecture-fixtures'

const ROLE_VERSION = 3

function buildManager(): TenantConnectionPoolManager {
  return new TenantConnectionPoolManager({
    clock: new FakePoolClock(0),
    scheduler: new TestPoolScheduler(),
  })
}

function buildMetadata(
  service: TenantJobPoolService,
  overrides?: { poolResourceKeys?: string[]; org?: 'a' | 'b' },
): TcpmJobPoolMetadata {
  const tenant = overrides?.org === 'b' ? buildOrgBContext() : buildOrgAContext()
  return service.buildMetadata({
    tenant,
    roleVersion: ROLE_VERSION,
    sourceRefs: ['src-hash-1'],
    idempotencyKey: 'idem-job-1',
    requestId: 'req-job-1',
    poolResourceKeys: overrides?.poolResourceKeys ?? ['export:report'],
  })
}

/** 与入队时一致的 membership（revalidate 通过）。 */
function freshMembership(organizationId: number) {
  return { organizationId, roleVersion: ROLE_VERSION, active: true }
}

// ──────────────────────────────────────────────
// §6.1/§6.2 入队元数据
// ──────────────────────────────────────────────

test.group('作业连接元数据（§6.1/§6.2）', () => {
  test('元数据含快照/requestId/幂等键/资源键/权限快照 hash', ({ assert }) => {
    const service = new TenantJobPoolService()
    const meta = buildMetadata(service)

    assert.equal(meta.requestId, 'req-job-1')
    assert.equal(meta.idempotencyKey, 'idem-job-1')
    assert.isString(meta.permissionSnapshotHash)
    assert.isAbove(meta.permissionSnapshotHash.length, 0)
    assert.equal(meta.scopeSnapshot.organizationId, buildOrgAContext().organizationId)
    // worker 槽位自动补齐，业务资源保留
    assert.include(meta.poolResourceKeys, JOB_WORKER_RESOURCE_KEY)
    assert.include(meta.poolResourceKeys, 'export:report')
  })

  test('权限快照 hash 与快照内一致（不可只改元数据绕过复核）', ({ assert }) => {
    const service = new TenantJobPoolService()
    const meta = buildMetadata(service)
    assert.equal(meta.permissionSnapshotHash, meta.scopeSnapshot.permissionSnapshotHash)

    const tampered = { ...meta, permissionSnapshotHash: 'forged-hash' }
    assert.throws(() => service.parse(JSON.stringify(tampered)), PermissionDeniedException)
  })

  test('未登记的连接资源在入队时即被拒（fail closed）', ({ assert }) => {
    const service = new TenantJobPoolService()
    assert.throws(() =>
      service.buildMetadata({
        tenant: buildOrgAContext(),
        roleVersion: ROLE_VERSION,
        sourceRefs: [],
        idempotencyKey: 'idem-x',
        requestId: 'req-x',
        poolResourceKeys: ['unregistered:resource'],
      }),
    )
  })

  test('序列化产物不含 raw JWT / secret / provider payload / 完整身份', ({ assert }) => {
    const service = new TenantJobPoolService()
    const raw = service.serialize(buildMetadata(service))

    // JWT 三段式
    assert.notMatch(raw, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./)
    assert.notMatch(raw, /sk-[A-Za-z0-9]/)
    assert.notMatch(raw, /"(password|token|accessToken|apiKey|authorization|email)"/i)
    // 组织标识只以 id + hash 出现，没有组织名/邮箱等可读身份
    assert.notMatch(raw, /@[a-z0-9.-]+\.[a-z]{2,}/i)
  })

  test('parse 往返稳定；结构损坏 fail closed', ({ assert }) => {
    const service = new TenantJobPoolService()
    const meta = buildMetadata(service)
    const restored = service.parse(service.serialize(meta))
    assert.deepEqual(restored.poolResourceKeys, meta.poolResourceKeys)
    assert.equal(restored.scopeSnapshot.organizationId, meta.scopeSnapshot.organizationId)

    assert.throws(() => service.parse('not-json'))
    assert.throws(() => service.parse({ requestId: 'x' }))
    assert.throws(() => service.parse(JSON.stringify({ ...meta, poolResourceKeys: [] })))
  })
})

// ──────────────────────────────────────────────
// §6.3/§6.4 worker 执行
// ──────────────────────────────────────────────

test.group('worker 执行 lease 复核（§6.3/§6.4）', () => {
  test('快照有效：worker 槽位与业务资源都拿到 lease，执行后全部释放', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)

    let ran = false
    const result = await service.runWithLeases({
      metadata: meta,
      revalidation: { currentMembership: freshMembership(meta.scopeSnapshot.organizationId) },
      operationKind: 'report_job',
      manager,
      run: async ({ leases }) => {
        ran = true
        assert.lengthOf(leases, 2)
        assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 1)
        assert.equal(manager.activeCount('export:report'), 1)
        return 'ok'
      },
    })

    assert.isTrue(ran)
    assert.equal(result, 'ok')
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
    assert.equal(manager.activeCount('export:report'), 0)
  })

  test('membership 失效（revoked）：不执行、不占任何 lease', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)

    let ran = false
    await assert.rejects(async () =>
      service.runWithLeases({
        metadata: meta,
        revalidation: { currentMembership: null },
        operationKind: 'report_job',
        manager,
        run: async () => {
          ran = true
          return 'should-not-run'
        },
      }),
    )
    assert.isFalse(ran)
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
    assert.equal(manager.activeCount('export:report'), 0)
  })

  test('权限快照过期（stale roleVersion）：fail closed', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)

    await assert.rejects(async () =>
      service.runWithLeases({
        metadata: meta,
        revalidation: {
          currentMembership: {
            organizationId: meta.scopeSnapshot.organizationId,
            roleVersion: ROLE_VERSION + 1,
            active: true,
          },
        },
        operationKind: 'report_job',
        manager,
        run: async () => 'should-not-run',
      }),
    )
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
  })

  test('跨租户（组织切换后旧作业）：fail closed，不触碰他租预算', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)
    const otherOrg = buildOrgBContext().organizationId

    await assert.rejects(async () =>
      service.runWithLeases({
        metadata: meta,
        revalidation: { currentMembership: freshMembership(otherOrg) },
        operationKind: 'report_job',
        manager,
        run: async () => 'should-not-run',
      }),
    )
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
  })

  test('幂等键已消费（重复执行）：fail closed', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)

    await assert.rejects(async () =>
      service.runWithLeases({
        metadata: meta,
        revalidation: {
          currentMembership: freshMembership(meta.scopeSnapshot.organizationId),
          idempotencyConsumed: true,
        },
        operationKind: 'report_job',
        manager,
        run: async () => 'should-not-run',
      }),
    )
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
  })

  test('作业抛错：全部 lease 在 finally 释放（retry 前不泄漏）', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)

    await assert.rejects(async () =>
      service.runWithLeases({
        metadata: meta,
        revalidation: { currentMembership: freshMembership(meta.scopeSnapshot.organizationId) },
        operationKind: 'report_job',
        manager,
        run: async () => {
          throw new Error('job side effect failure fixture')
        },
      }),
    )
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
    assert.equal(manager.activeCount('export:report'), 0)
  })

  test('worker resume：重试可再次获取同一组 lease', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)
    const revalidation = {
      currentMembership: freshMembership(meta.scopeSnapshot.organizationId),
    }

    await assert.rejects(async () =>
      service.runWithLeases({
        metadata: meta,
        revalidation,
        operationKind: 'report_job',
        manager,
        run: async () => {
          throw new Error('first attempt fails')
        },
      }),
    )
    // resume：同一元数据再跑一次必须能拿到 lease（说明上一次已完整释放）
    const second = await service.runWithLeases({
      metadata: service.parse(service.serialize(meta)),
      revalidation,
      operationKind: 'report_job',
      manager,
      run: async () => 'resumed',
    })
    assert.equal(second, 'resumed')
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 0)
  })

  test('worker 槽位耗尽：排队超时抛非泄露 timeout，不占活跃', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)
    const tenantId = meta.scopeSnapshot.organizationId

    // catalog：job:worker defaultTenantLimit=2 → 先占满
    for (let i = 0; i < 2; i++) {
      await manager.acquire({
        resourceKey: JOB_WORKER_RESOURCE_KEY,
        operationKind: 'hold',
        tenant: {
          organizationId: tenantId,
          projectId: null,
          scopeMode: 'organization_scoped',
          actorRef: 'service',
          isSuperAdmin: false,
        },
        requestId: `hold-${i}`,
      })
    }

    const p = service.runWithLeases({
      metadata: meta,
      revalidation: { currentMembership: freshMembership(tenantId) },
      operationKind: 'report_job',
      manager,
      run: async () => 'should-not-run',
    })
    await new Promise((r) => setImmediate(r))
    assert.equal(manager.queueLength(JOB_WORKER_RESOURCE_KEY), 1)
    manager.tickForTest(5001)

    try {
      await p
      assert.fail('应抛 timeout')
    } catch (e) {
      assert.instanceOf(e, ConnectionPoolTimeoutException)
    }
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 2)
  })

  test('取消（abort）：排队中的作业以取消结束，不执行副作用', async ({ assert }) => {
    const service = new TenantJobPoolService()
    const manager = buildManager()
    const meta = buildMetadata(service)
    const tenantId = meta.scopeSnapshot.organizationId
    for (let i = 0; i < 2; i++) {
      await manager.acquire({
        resourceKey: JOB_WORKER_RESOURCE_KEY,
        operationKind: 'hold',
        tenant: {
          organizationId: tenantId,
          projectId: null,
          scopeMode: 'organization_scoped',
          actorRef: 'service',
          isSuperAdmin: false,
        },
        requestId: `hold-${i}`,
      })
    }

    const controller = new AbortController()
    let ran = false
    const p = service.runWithLeases({
      metadata: meta,
      revalidation: { currentMembership: freshMembership(tenantId) },
      operationKind: 'report_job',
      abortSignal: controller.signal,
      manager,
      run: async () => {
        ran = true
        return 'should-not-run'
      },
    })
    await new Promise((r) => setImmediate(r))
    controller.abort()

    await assert.rejects(async () => p)
    assert.isFalse(ran)
    assert.equal(manager.activeCount(JOB_WORKER_RESOURCE_KEY), 2)
  })
})
