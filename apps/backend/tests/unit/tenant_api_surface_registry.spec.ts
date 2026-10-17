// v3-multitenant-api §3.3 —— TenantApiSurfaceRegistry 完整性 + 硬门禁覆盖测试。
// 覆盖：validate() 通过、受控资源/操作/kind、tenant-private 无 global 例外、lookup 语义、
// 以及"新增 tenant-scoped V3 route 必须登记"的 REGISTRY_GAP 门禁（未登记返回 null）。
import { test } from '@japa/runner'
import TenantApiSurfaceRegistry from '#services/tenant_api_surface_registry'

test.group('TenantApiSurfaceRegistry 完整性', () => {
  test('validate() 全量通过', ({ assert }) => {
    const problems = TenantApiSurfaceRegistry.validate()
    assert.deepEqual(problems, [], 'registry 声明不应有完整性/受控值问题')
  })

  test('registry 已登记本 change in-scope 的高风险 surface', ({ assert }) => {
    const all = TenantApiSurfaceRegistry.all()
    const patterns = all.map((s) => s.routePattern)
    assert.isAtLeast(patterns.length, 8, '至少覆盖 8 条 in-scope 高风险 surface')
    const must = [
      '/api/v1/projects',
      '/api/v1/projects/:id',
      '/api/v1/projects/:projectId/tasks',
      '/api/v1/projects/:projectId/tasks/batch',
      '/api/v1/ai/project-drafts/:id/confirm',
      '/api/v1/ai/compiler/runs/:id/events',
      '/api/v1/projects/:projectId/reports/v2/versions/:versionId/exports',
      '/api/v1/console/governance/summary',
    ]
    for (const p of must) {
      assert.isTrue(patterns.includes(p), '缺少 surface: ' + p)
    }
  })

  test('tenant 业务路由不得声明 global 例外', ({ assert }) => {
    for (const s of TenantApiSurfaceRegistry.all()) {
      if (
        s.responseSensitivity === 'tenant_private' ||
        s.responseSensitivity === 'tenant_low_sensitive'
      ) {
        assert.isFalse(
          s.isGlobalOptIn === true,
          s.routePattern + ' tenant-private 不得 global opt-in',
        )
        assert.isTrue(
          s.allowedScopeModes.includes('tenant'),
          s.routePattern + ' tenant 业务必须允许具体组织',
        )
      }
    }
  })

  test('lookup 按 method + route pattern 命中', ({ assert }) => {
    const s = TenantApiSurfaceRegistry.lookup('GET', '/api/v1/projects')
    assert.isNotNull(s)
    assert.equal(s?.routeName, 'projects.index')
  })

  test('global opt-in 只对显式登记的全局路由生效', ({ assert }) => {
    assert.isTrue(TenantApiSurfaceRegistry.isGlobalOptIn('/api/v1/console/governance/summary'))
    assert.isFalse(TenantApiSurfaceRegistry.isGlobalOptIn('/api/v1/projects'))
  })

  test('未登记的 tenant route 返回 null（REGISTRY_GAP 门禁）', ({ assert }) => {
    assert.isNull(TenantApiSurfaceRegistry.lookup('GET', '/api/v1/not-registered'))
  })
})
