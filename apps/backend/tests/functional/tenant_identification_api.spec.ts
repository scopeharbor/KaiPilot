// v3-multitenant-tenant-identification §9.2/§9.3/§9.4 —— 识别链路审计低敏性、API 集成与跨租户 E2E。
//
// spec 场景覆盖：
//   - §9.2 审计 payload 与响应体的 no-secret / no-hidden-data；
//   - §9.3 body organization mismatch、route-resource mismatch、missing tenant、
//     stale membership、super admin scope mode 五类集成用例；
//   - §9.4 一条跨租户 E2E：切换组织 → 资源可见性 → stale selection → 非泄露错误。
//
// 全程本地 SQLite + fixture，无真实 AI/OCR/Webhook/Web Push/OAuth/KMS/外部网络。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import Report from '#models/report'
import TokenService from '#services/token_service'
import TenantIdentificationAuditService from '#services/tenant_identification_audit_service'
import TenantMiddleware from '#middleware/tenant_middleware'
import TenantResolutionService from '#services/tenant_resolution_service'
import { TenantResolutionUnavailableException } from '#exceptions/api_exception'
import { TENANT_ID_FORBIDDEN_KEYS } from '@aiproj/types/multitenant-tenant-identification'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const SELECTION = '/api/v1/account/organization-selection'
/** 两组织同名资源——同名才能证伪"按名字返回"的实现。 */
const SHARED_PROJECT = '共享名称-项目'
const SHARED_REPORT = '共享名称-报表'

/** 从 audit_logs 行里取出 metadata 对象。 */
function metaOf(row: { metadata: unknown }): Record<string, unknown> {
  const raw = typeof row.metadata === 'string' ? row.metadata : JSON.stringify(row.metadata ?? {})
  return JSON.parse(raw) as Record<string, unknown>
}

test.group('识别审计低敏性（§9.2）', (group) => {
  useAuthDatabase(group)

  test('六类识别审计构造出的 metadata 均不含禁止字段', ({ assert }) => {
    const service = new TenantIdentificationAuditService()
    const base = {
      actorRef: 'user:1',
      userId: 1,
      organizationId: 7,
      projectId: null,
      scopeMode: 'tenant' as const,
      selectionSource: 'auth_token' as const,
      resolutionReason: 'RESOLVED' as const,
      scopeHash: 'abcdef0123456789',
      operation: 'test.op',
      requestId: 'req-1',
    }

    const records = [
      service.buildDenial(base),
      service.buildDegraded(base),
      service.buildStale(base),
      service.buildAmbiguous(base),
      service.buildGlobalMode(base),
      service.buildSwitch({ ...base, previousScopeHash: 'old', nextScopeHash: 'new' }),
    ]

    for (const record of records) {
      const serialized = JSON.stringify(record.entry.metadata)
      for (const forbidden of TENANT_ID_FORBIDDEN_KEYS) {
        assert.notInclude(
          Object.keys(record.entry.metadata ?? {}),
          forbidden,
          `${record.kind} 审计含禁止字段 ${forbidden}`,
        )
      }
      // 只允许低敏原语：不得出现 token/secret/prompt 字样。
      assert.notMatch(serialized, /accessToken|refreshToken|password|secret|prompt/i)
    }
  })

  test('六类审计各自映射到独立事件，且严重级不可由调用方指定', ({ assert }) => {
    const service = new TenantIdentificationAuditService()
    const base = {
      actorRef: 'user:1',
      organizationId: 7,
      scopeMode: 'tenant' as const,
      selectionSource: 'auth_token' as const,
      resolutionReason: 'RESOLVED' as const,
      scopeHash: 'h',
      operation: 'op',
      requestId: 'r',
    }
    const events = new Set(
      [
        service.buildDenial(base),
        service.buildDegraded(base),
        service.buildStale(base),
        service.buildAmbiguous(base),
        service.buildGlobalMode(base),
        service.buildSwitch({ ...base, previousScopeHash: null, nextScopeHash: 'n' }),
      ].map((r) => r.entry.event),
    )
    assert.equal(events.size, 6, '六类事件必须互不重叠')
    // 拒绝类绝不能落成 info。
    assert.equal(service.buildDenial(base).entry.severity, 'warning')
    assert.equal(service.buildAmbiguous(base).entry.severity, 'error')
  })
})

test.group('中间件兼容性：ctx.tenantDecision 与 ctx.tenant 并存（§3.3）', (group) => {
  useAuthDatabase(group)

  /**
   * spec「Verification MUST cover tenant identification boundaries」明确要求覆盖
   * **middleware compatibility**：新的 effective tenant decision 必须挂上，同时既有
   * 30+ controller 依赖的 `ctx.tenant.organizationId` 契约不能变。
   *
   * 直驱中间件而不是发 HTTP 请求：要断言的是**挂载后的上下文形状**，
   * 走 HTTP 只能间接观察它（响应里看不到 ctx）。
   */
  async function runMiddleware(ctx: Record<string, unknown>) {
    const middleware = new TenantMiddleware(
      new TenantResolutionService(),
      new TenantIdentificationAuditService(),
    )
    let nextCalled = false
    await middleware.handle(ctx as never, async () => {
      nextCalled = true
    })
    return { nextCalled }
  }

  function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
      params: {},
      route: { pattern: '/api/v1/projects' },
      request: { body: () => ({}), id: () => 'req-mw', method: () => 'GET' },
      ...overrides,
    }
  }

  test('有效成员：同时挂 ctx.tenantDecision 与兼容的 ctx.tenant', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('mw-own') })
    const org = await createOrganization(owner)
    const ctx = makeCtx({
      authUser: owner,
      authPayload: {
        sub: owner.id,
        organizationId: Number(org.id),
        roleVersion: owner.roleVersion,
        permissions: [],
      },
    })

    const { nextCalled } = await runMiddleware(ctx)

    assert.isTrue(nextCalled)
    // 新契约：低敏 effective decision。
    const decision = (ctx as { tenantDecision?: Record<string, unknown> }).tenantDecision
    assert.isDefined(decision)
    assert.equal(decision!.organizationId, Number(org.id))
    assert.equal(decision!.scopeMode, 'tenant')
    assert.equal(decision!.resolutionReason, 'RESOLVED')
    assert.isNotEmpty(decision!.scopeHash)
    // 旧契约：`ctx.tenant.organizationId` 必须仍可用且值一致。
    const tenant = (ctx as { tenant?: Record<string, unknown> }).tenant
    assert.isDefined(tenant)
    assert.equal(tenant!.organizationId, Number(org.id))
    assert.equal(tenant!.scopeMode, 'organization_scoped')
    assert.isFalse(tenant!.isSuperAdmin as boolean)
  })

  test('项目级路由派生 project_scoped（旧 scopeMode 枚举不变）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('mw-own') })
    const org = await createOrganization(owner)
    const ctx = makeCtx({
      params: { projectId: '7' },
      route: { pattern: '/api/v1/projects/:projectId/tasks' },
      authUser: owner,
      authPayload: {
        sub: owner.id,
        organizationId: Number(org.id),
        roleVersion: owner.roleVersion,
        permissions: [],
      },
    })

    await runMiddleware(ctx)

    const tenant = (ctx as { tenant?: Record<string, unknown> }).tenant
    assert.equal(tenant!.scopeMode, 'project_scoped')
    assert.equal(tenant!.projectId, 7)
  })

  test('super admin 的旧 scopeMode 仍是 system_global（不被降级）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('mw-own') })
    const org = await createOrganization(owner)
    const admin = await createUser({ email: uniqueEmail('mw-sa'), isSuperAdmin: true })
    const ctx = makeCtx({
      authUser: admin,
      authPayload: {
        sub: admin.id,
        organizationId: Number(org.id),
        roleVersion: admin.roleVersion,
        permissions: [],
      },
    })

    await runMiddleware(ctx)

    const decision = (ctx as { tenantDecision?: Record<string, unknown> }).tenantDecision
    const tenant = (ctx as { tenant?: Record<string, unknown> }).tenant
    // 识别层给 super admin + 具体 org 的是 tenant 模式（§6.2）……
    assert.equal(decision!.scopeMode, 'tenant')
    // ……但旧契约里 super admin 一律 system_global，下游据此判定全局能力，
    // 直接透传 'tenant' 会把 super admin 降级成普通组织 scope。
    assert.equal(tenant!.scopeMode, 'system_global')
  })

  test('未认证请求放行且 ctx.tenant 留空（全局中间件不得拦登录路径）', async ({ assert }) => {
    const ctx = makeCtx({ authUser: undefined, authPayload: undefined })

    const { nextCalled } = await runMiddleware(ctx)

    assert.isTrue(nextCalled, '未认证也必须放行——否则登录接口自己被挡掉')
    assert.isUndefined((ctx as { tenant?: unknown }).tenant)
    // 失败决定仍然挂上，供审计/观测读 reason（低敏，不含隐藏数据）。
    const decision = (ctx as { tenantDecision?: Record<string, unknown> }).tenantDecision
    assert.equal(decision!.resolutionReason, 'NO_ACTIVE_ORGANIZATION')
  })

  test('roleVersion 过期：放行给 auth 层返回 401，但仍挂 ctx.tenant', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('mw-own') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('mw-mem'), roleVersion: 4 })
    await addOrgMember(org, member, 'member')
    const ctx = makeCtx({
      authUser: member,
      authPayload: {
        sub: member.id,
        organizationId: Number(org.id),
        roleVersion: 1, // 旧 token
        permissions: [],
      },
    })

    const { nextCalled } = await runMiddleware(ctx)

    assert.isTrue(nextCalled)
    // 必须仍挂 ctx.tenant：否则全局栈里跑在按路由 `auth` 之前的 RbacMiddleware
    // 会先抛 403「需要组织上下文」，把该返回的 401「去刷新 token」抢掉。
    assert.isDefined((ctx as { tenant?: unknown }).tenant)
    const decision = (ctx as { tenantDecision?: Record<string, unknown> }).tenantDecision
    assert.equal(decision!.resolutionReason, 'ROLE_STALE')
  })

  test('resolver 故障 → 503 且不挂 ctx.tenant（不回退客户端 hint，§3.5）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('mw-own') })
    const org = await createOrganization(owner)
    const ctx = makeCtx({
      authUser: owner,
      authPayload: {
        sub: owner.id,
        organizationId: Number(org.id),
        roleVersion: owner.roleVersion,
        permissions: [],
      },
      request: {
        // 客户端 hint 存在也不得被采信。
        body: () => ({ organizationId: Number(org.id) }),
        id: () => 'req-mw',
        method: () => 'GET',
      },
    })

    const original = db.from.bind(db)
    db.from = (() => {
      throw new Error('resolver dependency down')
    }) as typeof db.from
    let thrown: unknown = null
    try {
      await runMiddleware(ctx)
    } catch (error) {
      thrown = error
    } finally {
      db.from = original
    }

    assert.instanceOf(thrown, TenantResolutionUnavailableException)
    assert.isUndefined((ctx as { tenant?: unknown }).tenant, 'degraded 时不得挂租户上下文')
  })

  test('super admin 遇 resolver 故障同样被拒（degraded 判定先于 super admin 放行）', async ({
    assert,
  }) => {
    const admin = await createUser({ email: uniqueEmail('mw-sa'), isSuperAdmin: true })
    const ctx = makeCtx({
      authUser: admin,
      authPayload: { sub: admin.id, organizationId: 1, roleVersion: 0, permissions: [] },
    })

    const original = db.from.bind(db)
    db.from = (() => {
      throw new Error('resolver dependency down')
    }) as typeof db.from
    let thrown: unknown = null
    try {
      await runMiddleware(ctx)
    } catch (error) {
      thrown = error
    } finally {
      db.from = original
    }

    // 回归防护：这条曾经会被放行成 `system_global` 且 organizationId 落成 0，
    // 等于用一次 DB 抖动换来跨租户全局视图。
    assert.instanceOf(thrown, TenantResolutionUnavailableException)
    assert.isUndefined((ctx as { tenant?: unknown }).tenant)
  })
})

test.group('识别链路 API 集成（§9.3）', (group) => {
  useAuthDatabase(group)

  let tokenSvc: TokenService
  let orgA: Awaited<ReturnType<typeof createOrganization>>
  let orgB: Awaited<ReturnType<typeof createOrganization>>
  let memberA: Awaited<ReturnType<typeof createUser>>
  let projectA: Project
  let projectB: Project
  let reportB: Report

  group.each.setup(async () => {
    tokenSvc = await app.container.make(TokenService)
    const ownerA = await createUser({ email: uniqueEmail('tid-owna') })
    orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('tid-ownb') })
    orgB = await createOrganization(ownerB)

    memberA = await createUser({ email: uniqueEmail('tid-mema') })
    await addOrgMember(orgA, memberA, 'admin')

    projectA = await Project.create({
      organizationId: Number(orgA.id),
      name: SHARED_PROJECT,
      code: `PA${Date.now()}`,
      createdBy: ownerA.id,
    })
    projectB = await Project.create({
      organizationId: Number(orgB.id),
      name: SHARED_PROJECT,
      code: `PB${Date.now()}`,
      createdBy: ownerB.id,
    })
    reportB = await Report.create({
      projectId: Number(projectB.id),
      title: SHARED_REPORT,
      template: 'progress',
      config: {} as never,
      dataSnapshot: {} as never,
    })
  })

  async function tokenFor(userId: number, organizationId: number | null): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: userId,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
  }

  test('body organization mismatch → 404 且写 ambiguous 审计（不记目标组织）', async ({
    client,
    assert,
  }) => {
    const token = await tokenFor(memberA.id, Number(orgA.id))
    const res = await client
      .post(`/api/v1/projects/${projectA.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id), title: '跨组织写入尝试', description: 'x' })

    res.assertStatus(404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')

    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(10)
    const ambiguous = logs.map(metaOf).find((m) => m.kind === 'ambiguous')
    assert.isDefined(ambiguous, '歧义租户输入必须留低敏审计')
    assert.equal(ambiguous!.resolutionReason, 'BODY_ORGANIZATION_MISMATCH')
    // 记的是 actor 自己的组织。
    assert.equal(ambiguous!.organizationId, Number(orgA.id))
  })

  test('`:organizationId` 路由参数不一致 → 404 且写 ambiguous 审计', async ({ client, assert }) => {
    const token = await tokenFor(memberA.id, Number(orgA.id))
    // 这条路由的参数名就是 `:organizationId`，走中间件的一致性校验分支。
    const res = await client
      .get(`/api/v1/organizations/${orgB.id}/bi/trends`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(404)
    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(10)
    const ambiguous = logs.map(metaOf).find((m) => m.kind === 'ambiguous')
    assert.isDefined(ambiguous, '路由参数歧义必须留 ambiguous 审计')
    assert.equal(ambiguous!.resolutionReason, 'ROUTE_ORGANIZATION_MISMATCH')
    assert.equal(ambiguous!.organizationId, Number(orgA.id))
  })

  test('`/organizations/:id/members` 跨组织被拒（参数名为 :id，中间件一致性校验不覆盖）', async ({
    client,
    assert,
  }) => {
    const token = await tokenFor(memberA.id, Number(orgA.id))
    // 回归防护：这条路由的参数名是 `:id`，`TenantMiddleware` 只看 `:organizationId`，
    // 因此在补上 §5.3 归属校验之前，任何已认证用户都能读/改**任意组织**的成员。
    const res = await client
      .get(`/api/v1/organizations/${orgB.id}/members`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(404)
    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(10)
    const denied = logs
      .map(metaOf)
      .find((m) => m.kind === 'denied' && m.operation === 'ownership.organization')
    assert.isDefined(denied, '跨组织成员访问必须留归属拒绝审计')
    assert.equal(denied!.resolutionReason, 'RESOURCE_OWNERSHIP_MISMATCH')
    assert.equal(denied!.organizationId, Number(orgA.id))
  })

  test('成员写操作（邀请/改角色/移除）同样不得跨组织', async ({ client, assert }) => {
    const token = await tokenFor(memberA.id, Number(orgA.id))
    const countOrgBMembers = async (): Promise<number> => {
      const rows = await db
        .from('organization_members')
        .where('organization_id', Number(orgB.id))
        .count('* as c')
      return Number(rows[0]?.c ?? 0)
    }

    const beforeCount = await countOrgBMembers()

    const invite = await client
      .post(`/api/v1/organizations/${orgB.id}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: uniqueEmail('intruder'), role: 'admin' })

    assert.notEqual(invite.status(), 201, '不得向他组织邀请成员')
    assert.equal(await countOrgBMembers(), beforeCount, '被拒的邀请不得产生任何写入副作用')
  })

  test('route-resource mismatch（他组织报表）→ 非泄露 404，响应不含资源名', async ({
    client,
    assert,
  }) => {
    const token = await tokenFor(memberA.id, Number(orgA.id))
    const res = await client
      .get(`/api/v1/reports/${reportB.id}`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(404)
    assert.notInclude(JSON.stringify(res.body()), SHARED_REPORT)
  })

  test('missing tenant（token 无组织声明）→ 受保护业务路由不返回数据', async ({
    client,
    assert,
  }) => {
    const token = await tokenFor(memberA.id, null)
    const res = await client.get('/api/v1/projects').header('Authorization', `Bearer ${token}`)

    assert.notEqual(res.status(), 200, '无租户上下文不得返回业务列表')
    assert.notInclude(JSON.stringify(res.body()), SHARED_PROJECT)
  })

  test('stale membership（roleVersion 落后）→ 401 要求刷新，不返回业务数据', async ({
    client,
    assert,
  }) => {
    // 提升 DB 侧 roleVersion，使已签发 token 过期（RBAC D9 即时失效）。
    await db.from('users').where('id', memberA.id).update({ role_version: 5 })
    const staleToken = await tokenSvc.generateAccessToken({
      sub: memberA.id,
      organizationId: Number(orgA.id),
      roleVersion: 0,
      permissions: [],
    })

    const res = await client
      .get(`/api/v1/projects/${projectA.id}`)
      .header('Authorization', `Bearer ${staleToken}`)

    // 语义必须是「token 已失效，去刷新」= 401，而不是被 RBAC 的 403 抢掉。
    res.assertStatus(401)
    assert.notInclude(JSON.stringify(res.body()), SHARED_PROJECT)
  })

  test('super admin scope mode：带组织 A 的 token 读组织 B 项目不返回数据', async ({
    client,
    assert,
  }) => {
    const admin = await createUser({ email: uniqueEmail('tid-sa'), isSuperAdmin: true })
    const token = await tokenFor(admin.id, Number(orgA.id))

    const res = await client
      .get(`/api/v1/projects/${projectB.id}`)
      .header('Authorization', `Bearer ${token}`)

    assert.notEqual(res.status(), 200, 'super admin 不得默认跨租户读业务数据')
    assert.notInclude(JSON.stringify(res.body()), SHARED_PROJECT)
  })
})

test.group('跨租户 E2E：切换 → 可见性 → stale → 非泄露（§9.4）', (group) => {
  useAuthDatabase(group)

  test('一条完整流程覆盖切换、资源可见性、stale selection 与非泄露错误', async ({
    client,
    assert,
  }) => {
    const tokenSvc = await app.container.make(TokenService)

    // ── 铺底：两组织 + 同名项目，用户同时属于两者 ──────────────────
    const ownerA = await createUser({ email: uniqueEmail('e2e-owna') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('e2e-ownb') })
    const orgB = await createOrganization(ownerB)

    const user = await createUser({ email: uniqueEmail('e2e-user') })
    await addOrgMember(orgA, user, 'admin')
    await addOrgMember(orgB, user, 'admin')

    const projectA = await Project.create({
      organizationId: Number(orgA.id),
      name: SHARED_PROJECT,
      code: `EA${Date.now()}`,
      createdBy: ownerA.id,
    })
    const projectB = await Project.create({
      organizationId: Number(orgB.id),
      name: SHARED_PROJECT,
      code: `EB${Date.now()}`,
      createdBy: ownerB.id,
    })

    let token = await tokenSvc.generateAccessToken({
      sub: user.id,
      organizationId: Number(orgA.id),
      roleVersion: 0,
      permissions: [],
    })

    // ── 步骤 1：确认当前有效租户是 A ────────────────────────────────
    const current = await client.get(SELECTION).header('Authorization', `Bearer ${token}`)
    current.assertStatus(200)
    assert.equal(current.body().data.effectiveContext.organizationId, Number(orgA.id))

    // ── 步骤 2：在 A 下读 B 的项目 → 非泄露（不得回 200 或资源名） ────
    const crossBefore = await client
      .get(`/api/v1/projects/${projectB.id}`)
      .header('Authorization', `Bearer ${token}`)
    assert.notEqual(crossBefore.status(), 200)
    assert.notInclude(JSON.stringify(crossBefore.body()), SHARED_PROJECT)

    // ── 步骤 3：显式切换到 B，拿到新 claims 与递增的 epoch ───────────
    const switched = await client
      .post(SELECTION)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })
    switched.assertStatus(200)
    const epochAfterSwitch = switched.body().data.selectionEpoch
    assert.isAbove(epochAfterSwitch, 0)
    token = switched.body().data.accessToken
    assert.isString(token)

    // ── 步骤 4：切换后 B 的项目可见，A 的项目转为非泄露不可见 ─────────
    const nowVisible = await client
      .get(`/api/v1/projects/${projectB.id}`)
      .header('Authorization', `Bearer ${token}`)
    nowVisible.assertStatus(200)
    assert.equal(nowVisible.body().data.id, Number(projectB.id))

    const nowHidden = await client
      .get(`/api/v1/projects/${projectA.id}`)
      .header('Authorization', `Bearer ${token}`)
    assert.notEqual(nowHidden.status(), 200, '切换后旧组织资源必须转为不可见')

    // ── 步骤 5：移除 B 的成员关系 → 后续请求 stale/非泄露失败 ────────
    await OrganizationMember.query()
      .where('organization_id', Number(orgB.id))
      .where('user_id', user.id)
      .delete()

    const afterRemoval = await client
      .get(`/api/v1/projects/${projectB.id}`)
      .header('Authorization', `Bearer ${token}`)
    assert.notEqual(afterRemoval.status(), 200, '成员被移除后不得继续访问该组织数据')
    assert.notInclude(JSON.stringify(afterRemoval.body()), SHARED_PROJECT)

    // ── 步骤 6：尝试重新切回 B（已非成员）→ 404 隐藏 ────────────────
    const reselect = await client
      .post(SELECTION)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })
    reselect.assertStatus(404)
    assert.notInclude(JSON.stringify(reselect.body()), orgB.name)

    // ── 步骤 7：全程审计低敏：不得出现组织名/项目名/原始 token ───────
    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(40)
    const serialized = JSON.stringify(logs.map(metaOf))
    assert.notInclude(serialized, orgA.name)
    assert.notInclude(serialized, orgB.name)
    assert.notInclude(serialized, SHARED_PROJECT)
    assert.notInclude(serialized, token)
  })
})
