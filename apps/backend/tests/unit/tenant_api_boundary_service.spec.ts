// v3-multitenant-api §3.7 —— TenantApiBoundaryService 单元测试。
// 覆盖：lifecycle 顺序（scope 先于业务）、route/body/query 不一致拒绝、缺租户失败关闭、
// registry gap、super admin global opt-in、非泄露错误映射。
import { test } from '@japa/runner'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import TenantApiBoundaryService, {
  type TenantBoundaryInput,
} from '#services/tenant_api_boundary_service'

const S = new TenantApiBoundaryService()

function input(overrides: Partial<TenantBoundaryInput> = {}): TenantBoundaryInput {
  return {
    requestId: 'req-1',
    method: 'GET',
    routePattern: '/api/v1/projects',
    serverOrganizationId: 100,
    scopeMode: 'tenant',
    scopeHash: 'a'.repeat(16),
    operation: 'list',
    hints: {},
    ...overrides,
  }
}

test.group('TenantApiBoundaryService：tenant-bound lifecycle', () => {
  test('合法 tenant 请求放行且带低敏 metadata', ({ assert }) => {
    const r = S.resolveBoundary(input())
    assert.isTrue(r.resolution.allowed)
    assert.equal(r.resolution.reasonCode, 'OK')
    assert.isFalse(isForbidden(r.metadata))
    assert.isNotNull(r.metadata)
    assert.equal(r.metadata?.cacheNamespace.includes('map:cache:'), true)
  })

  test('scope mode 未在 surface 声明 -> GLOBAL_NOT_ALLOWED', ({ assert }) => {
    const r = S.resolveBoundary(input({ scopeMode: 'global-low-sensitive' }))
    assert.isFalse(r.resolution.allowed)
    assert.equal(r.resolution.reasonCode, 'GLOBAL_NOT_ALLOWED')
  })

  test('缺具体组织且非 global opt-in -> MISSING_TENANT 拒绝', ({ assert }) => {
    const r = S.resolveBoundary(
      input({ serverOrganizationId: null, scopeMode: 'global-low-sensitive' }),
    )
    assert.isFalse(r.resolution.allowed)
    assert.equal(r.resolution.reasonCode, 'MISSING_TENANT')
  })

  test('global opt-in 路由在全局 scope 下放行', ({ assert }) => {
    const r = S.resolveBoundary(
      input({
        method: 'GET',
        routePattern: '/api/v1/console/governance/summary',
        serverOrganizationId: null,
        scopeMode: 'global-low-sensitive',
        operation: 'admin',
      }),
    )
    assert.isTrue(r.resolution.allowed)
  })

  test('route hint 组织与服务端不一致 -> 拒绝且不泄露', ({ assert }) => {
    const r = S.resolveBoundary(input({ hints: { routeOrganizationId: 999 } }))
    assert.isFalse(r.resolution.allowed)
    assert.equal(r.resolution.reasonCode, 'ROUTE_ORGANIZATION_MISMATCH')
  })

  test('query 组织过滤器不能扩大 scope', ({ assert }) => {
    const r = S.resolveBoundary(input({ hints: { queryOrganizationId: 999 } }))
    assert.isFalse(r.resolution.allowed)
    assert.equal(r.resolution.reasonCode, 'QUERY_ORGANIZATION_MISMATCH')
  })

  test('未登记 surface -> REGISTRY_GAP', ({ assert }) => {
    const r = S.resolveBoundary(input({ routePattern: '/api/v1/not-registered' }))
    assert.isFalse(r.resolution.allowed)
    assert.equal(r.resolution.reasonCode, 'REGISTRY_GAP')
  })
})

test.group('TenantApiBoundaryService：非泄露错误映射', () => {
  test('跨租户 RESOURCE_NOT_FOUND 隐藏存在性', ({ assert }) => {
    const r = S.resolveBoundary(input({ hints: { bodyOrganizationId: 999 } }))
    assert.throws(() => S.handleNonLeaking(r.resolution), ResourceNotFoundException)
  })

  test('缺组织上下文 -> PERMISSION_DENIED', ({ assert }) => {
    const r = S.resolveBoundary(input({ serverOrganizationId: null }))
    assert.throws(() => S.handleNonLeaking(r.resolution), PermissionDeniedException)
  })
})

/** 低敏 metadata 不应包含 engine 未声明字段之外的东西。 */
function isForbidden(m: unknown): boolean {
  if (!m) return false
  const keys = Object.keys(m)
  return keys.some((k) => k.includes('secret') || k.includes('token') || k.includes('prompt'))
}
