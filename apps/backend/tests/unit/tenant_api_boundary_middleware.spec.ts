// v3-multitenant-api §3.5 —— TenantApiBoundaryMiddleware 单元测试。
// 覆盖：registry 命中后代 boundary 校验并挂低敏 metadata、未登记（legacy）直接放行、
// 不一致 hint 拒绝并抛非泄露错误、缺组织 fail closed。
//
// 用最小 HttpContext mock（只提供 middleware handle() 实际读取的字段），不依赖真实
// Adonis 容器；middleware 分解委托给已单测的 TenantApiBoundaryService（§3.7）。
import { test } from '@japa/runner'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import TenantApiBoundaryMiddleware from '#middleware/tenant_api_boundary_middleware'
import TenantApiBoundaryService from '#services/tenant_api_boundary_service'

// DI 由 Adonis 容器提供；这里手工传入真实服务实例，不 mock registry 避免漂移。
const SVC = new TenantApiBoundaryService()

/** 仅暴露 middleware handle() 需要的 HttpContext 字段（宽松类型，测试正是验证这些读取）。 */
interface MockCtx {
  route?: { pattern?: string; name?: string | null }
  request: {
    method(): string
    id(): string
    input(key: string): unknown
    body(): unknown
  }
  params: Record<string, unknown>

  tenantDecision?: any | null

  tenant?: any | null
  tenantApiBoundary?: unknown
}

function makeCtx(partial: Partial<MockCtx> = {}): {
  ctx: MockCtx
  run: () => Promise<boolean>
} {
  const baseRequest = {
    method: () => 'GET',
    id: () => 'req-id-1',
    input: () => undefined,
    body: () => ({}),
  }
  const { request: partialRequest, params: partialParams, ...rest } = partial
  const ctx: MockCtx = {
    ...rest,
    request: { ...baseRequest, ...(partialRequest ?? {}) },
    params: { ...(partialParams ?? {}) },
  }
  const mw = new TenantApiBoundaryMiddleware(SVC)
  const run = async (): Promise<boolean> => {
    let called = false

    await mw.handle(ctx as any, async () => {
      called = true
    })
    return called
  }
  return { ctx, run }
}

function tenantDecision(orgId: number, scopeMode: 'tenant' | 'global-low-sensitive' = 'tenant') {
  return {
    organizationId: orgId,
    scopeMode,
    scopeHash: 'a'.repeat(16),
    actorRef: 'user:1',
    resolvedAt: new Date().toISOString(),
    selectionSource: 'auth_token',
    resolutionReason: 'RESOLVED',
  }
}

test.group('TenantApiBoundaryMiddleware：registry surface 执行', () => {
  test('已登记 route + 合法 tenant -> 放行且挂低敏 metadata', async ({ assert }) => {
    const { ctx, run } = makeCtx({
      route: { pattern: '/api/v1/projects' },
      tenantDecision: tenantDecision(100),
      tenant: { organizationId: 100, projectId: null, scopeMode: 'organization_scoped' },
    })
    const nextCalled = await run()
    assert.isTrue(nextCalled)
    assert.isDefined(ctx.tenantApiBoundary)
    const md = ctx.tenantApiBoundary as {
      decision: string
      reasonCode: string
      cacheNamespace: string
    }
    assert.equal(md.decision, 'allow')
    assert.equal(md.reasonCode, 'OK')
    assert.isTrue(md.cacheNamespace.startsWith('map:cache:'))
  })

  test('已登记 route + 缺组织（非 global）-> non-leaking 拒绝', async ({ assert }) => {
    const { run } = makeCtx({
      route: { pattern: '/api/v1/projects' },
      tenantDecision: null,
      tenant: null,
    })
    await assert.rejects(() => run(), PermissionDeniedException)
  })

  test('body 组织不一致 -> RESOURCE_NOT_FOUND', async ({ assert }) => {
    const { run } = makeCtx({
      route: { pattern: '/api/v1/projects' },
      tenantDecision: tenantDecision(100),
      tenant: { organizationId: 100, projectId: null, scopeMode: 'organization_scoped' },
      request: {
        method: () => 'GET',
        id: () => 'req-x',
        input: () => undefined,
        body: () => ({ organizationId: 999 }),
      },
    })
    await assert.rejects(() => run(), ResourceNotFoundException)
  })

  test('query 组织过滤器扩大 -> RESOURCE_NOT_FOUND', async ({ assert }) => {
    const { run } = makeCtx({
      route: { pattern: '/api/v1/projects' },
      tenantDecision: tenantDecision(100),
      tenant: { organizationId: 100, projectId: null, scopeMode: 'organization_scoped' },
      request: {
        method: () => 'GET',
        id: () => 'req-x',
        input: (k: string) => (k === 'organizationId' ? 999 : undefined),
        body: () => ({}),
      },
    })
    await assert.rejects(() => run(), ResourceNotFoundException)
  })

  test('global opt-in route 在全局 scope 下放行', async ({ assert }) => {
    const { ctx, run } = makeCtx({
      route: { pattern: '/api/v1/console/governance/summary' },
      tenantDecision: {
        ...tenantDecision(0),
        organizationId: null,
        scopeMode: 'global-low-sensitive',
      },
      tenant: null,
    })
    const nextCalled = await run()
    assert.isTrue(nextCalled)
    const md = ctx.tenantApiBoundary as { decision: string; reasonCode: string }
    assert.equal(md.decision, 'allow')
    assert.equal(md.reasonCode, 'OK')
  })
})

test.group('TenantApiBoundaryMiddleware：legacy 兼容', () => {
  test('未登记 route -> 直接放行，不挂 metadata、不抛错', async ({ assert }) => {
    const { ctx, run } = makeCtx({
      route: { pattern: '/api/v1/not-registered' },
      tenantDecision: null,
      tenant: null,
    })
    const nextCalled = await run()
    assert.isTrue(nextCalled)
    assert.isUndefined(ctx.tenantApiBoundary)
  })
})
