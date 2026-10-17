/**
 * v3-multitenant-connection-pool-management §6.5/§6.6 —— 连接池错误的 API 语义。
 *
 * 断言：
 * - 写接口（导出创建）在租户连接预算耗尽时返回统一错误体 `{ error: { code, message } }`，
 *   code 为 `CONNECTION_POOL_*`，status 503；
 * - 错误体不泄露其他租户的活跃/排队数、provider 名称、连接串或原始驱动错误；
 * - 读接口（导出列表）不因连接池状态而暴露任何跨租户容量信息。
 *
 * 全程本机 SQLite + 进程内 pool manager，无 Redis、无真实外部 provider。
 */
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import TenantConnectionPoolManager from '#services/tenant_connection_pool_manager'
import { setPoolManagerForTest, resetPoolManager } from '#services/tenant_connection_pool_wrapper'
import {
  tcpmHasForbiddenPoolLabels,
  type TcpmPoolMetricsLabel,
} from '@aiproj/types/multitenant-connection-pool-management'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const V2_PREFIX = '/api/v1/projects'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setupProject(org: Organization, creator: User) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { project }
}

/** 占满某组织在 export:report 上的活跃与队列，使后续 acquire 直接被拒。 */
async function saturateExportPool(
  manager: TenantConnectionPoolManager,
  organizationId: number,
): Promise<void> {
  const req = {
    resourceKey: 'export:report',
    operationKind: 'hold',
    tenant: {
      organizationId,
      projectId: null,
      scopeMode: 'organization_scoped' as const,
      actorRef: 'service',
      isSuperAdmin: false,
    },
    requestId: 'hold',
  }
  // catalog：export:report defaultTenantLimit=1 / queueLimit=6
  await manager.acquire({ ...req, requestId: 'active-0' })
  for (let i = 0; i < 6; i++) {
    void manager.acquire({ ...req, requestId: `queued-${i}` })
  }
}

test.group('V2 报表导出 — 连接池错误 API 语义（§6.5/§6.6）', (group) => {
  useAuthDatabase(group)
  group.each.teardown(() => resetPoolManager())

  async function createVersionForExport(
    client: ApiClient,
    token: string,
    projectId: number,
    orgId: number,
  ) {
    const res = await client
      .post(`${V2_PREFIX}/${projectId}/reports/v2/versions`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(orgId))
      .json({ templateId: 'progress', previewSnapshotHash: 'pool-error-hash' })
    return res.body().data.version.id
  }

  test('写接口：连接预算耗尽返回 503 + CONNECTION_POOL_* 统一错误体', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pool-export-503') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    const versionId = await createVersionForExport(
      client,
      token,
      Number(project.id),
      Number(org.id),
    )

    // 版本创建完成后再占满导出预算，避免影响前置准备
    const manager = new TenantConnectionPoolManager()
    setPoolManagerForTest(manager)
    await saturateExportPool(manager, Number(org.id))

    const res = await client
      .post(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))
      .json({ format: 'csv' })

    res.assertStatus(503)
    const body = res.body()
    assert.isDefined(body.error)
    assert.match(body.error.code, /^CONNECTION_POOL_/)
    assert.isString(body.error.message)

    // 非泄露：无其他租户活跃/排队数、无 provider/连接串/驱动错误原文
    const raw = JSON.stringify(body)
    assert.notMatch(raw, /queue|active|tenantLimit|globalLimit/i)
    assert.notMatch(raw, /sqlite|knex|postgres|redis|insert into|select \*/i)
    assert.notMatch(raw, /organization_id|scopeHash|resourceKey/i)
  })

  test('读接口：连接池饱和时列表仍正常且不暴露容量信息', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-export-list') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    const versionId = await createVersionForExport(
      client,
      token,
      Number(project.id),
      Number(org.id),
    )

    const manager = new TenantConnectionPoolManager()
    setPoolManagerForTest(manager)
    await saturateExportPool(manager, Number(org.id))

    const res = await client
      .get(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(token)
      .header('X-Tenant-Id', String(org.id))

    res.assertStatus(200)
    const raw = JSON.stringify(res.body())
    assert.notMatch(raw, /queueLength|activeCount|circuitState|poolKind/i)
  })

  test('本机 SQLite 回归：租户 API 请求排队 → 释放后授予 → 低敏 metric 发射（§7.4）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pool-export-queued') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    const versionId = await createVersionForExport(
      client,
      token,
      Number(project.id),
      Number(org.id),
    )

    const metrics: TcpmPoolMetricsLabel[] = []
    const manager = new TenantConnectionPoolManager({ onMetrics: (l) => metrics.push(l) })
    setPoolManagerForTest(manager)

    // export:report defaultTenantLimit=1：先占满，使随后的 API 请求进入有界队列
    const held = await manager.acquire({
      resourceKey: 'export:report',
      operationKind: 'hold',
      tenant: {
        organizationId: Number(org.id),
        projectId: null,
        scopeMode: 'organization_scoped',
        actorRef: 'service',
        isSuperAdmin: false,
      },
      requestId: 'hold-queued',
    })
    assert.equal(held.decision, 'granted')

    // ApiRequest 是惰性 thenable：不 await 就不会真正发出请求。
    // 这里用立即执行的异步函数把它启动，再在主线程轮询队列长度。
    const pending = (async () =>
      client
        .post(`${V2_PREFIX}/${project.id}/reports/v2/versions/${versionId}/exports`)
        .bearerToken(token)
        .header('X-Tenant-Id', String(org.id))
        .json({ format: 'markdown' }))()

    // 等请求走完认证/权限/版本解析并在 createExport 处入队（固定 sleep 不可靠，改为轮询）。
    // export:report acquireTimeoutMs=5000，这里给 3s 上限，留足释放窗口。
    const queuedAt = Date.now()
    while (manager.queueLength('export:report') === 0 && Date.now() - queuedAt < 3000) {
      await new Promise((r) => setTimeout(r, 25))
    }
    assert.equal(manager.queueLength('export:report'), 1)
    manager.release(held.lease!, { success: true })

    const res = await pending
    res.assertStatus(201)
    assert.isDefined(res.body().data.exportId)

    // 决策序列覆盖 granted（排队后授予）与 released
    const decisions = metrics
      .filter((m) => m.resourceKey === 'export:report')
      .map((m) => m.decision)
    assert.include(decisions, 'granted')
    assert.include(decisions, 'released')
    // 排队确实发生过：授予时带非零等待
    const grantedWithWait = metrics.filter(
      (m) => m.resourceKey === 'export:report' && m.decision === 'granted' && m.queueWaitMs > 0,
    )
    assert.isAtLeast(grantedWithWait.length, 1)
    // 全部 metric 低敏
    for (const m of metrics) {
      assert.isFalse(tcpmHasForbiddenPoolLabels(m), `含禁止字段: ${JSON.stringify(m)}`)
    }
    assert.equal(manager.activeCount('export:report'), 0)
  })

  test('他租饱和不影响本租写入（预算按组织计量，不构成跨租户侧信道）', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('pool-export-org-a') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('pool-export-org-b') })
    const orgB = await createOrganization(ownerB)
    const { project: projectB } = await setupProject(orgB, ownerB)
    const tokenB = await login(client, ownerB)
    const versionId = await createVersionForExport(
      client,
      tokenB,
      Number(projectB.id),
      Number(orgB.id),
    )

    const manager = new TenantConnectionPoolManager()
    setPoolManagerForTest(manager)
    // 只占满 org A 的预算
    await saturateExportPool(manager, Number(orgA.id))

    const res = await client
      .post(`${V2_PREFIX}/${projectB.id}/reports/v2/versions/${versionId}/exports`)
      .bearerToken(tokenB)
      .header('X-Tenant-Id', String(orgB.id))
      .json({ format: 'csv' })

    res.assertStatus(201)
    assert.isDefined(res.body().data.exportId)
  })
})
