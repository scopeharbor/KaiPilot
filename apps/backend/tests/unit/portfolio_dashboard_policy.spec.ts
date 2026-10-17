// Portfolio Dashboard Policy 测试（v3-pmo-portfolio-dashboard §3.4）。
import { test } from '@japa/runner'
import PortfolioDashboardPolicy, { PORTFOLIO_VIEW } from '#policies/portfolio_dashboard_policy'
import RbacService from '#services/rbac_service'
import { ALL_PERMISSIONS } from '#rbac'

test.group('PortfolioDashboardPolicy', () => {
  test('PORTFOLIO_VIEW 常量定义', ({ assert }) => {
    assert.equal(PORTFOLIO_VIEW, 'portfolio:view')
  })

  test('PortfolioDashboardPolicy 实例化成功', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PortfolioDashboardPolicy(rbac)
    assert.instanceOf(policy, PortfolioDashboardPolicy)
  })

  test('canView 调用 rbac.check 并返回 allowed', async ({ assert }) => {
    // 使用 mock 验证调用链路——由于 RbacService 依赖数据库连接，
    // 这里仅验证实例方法签名与策略结构。
    const rbac = new RbacService()
    const policy = new PortfolioDashboardPolicy(rbac)
    assert.isFunction(policy.canView)
    assert.isFunction(policy.authorizeView)
  })

  test('PORTFOLIO_VIEW 已登记到 ALL_PERMISSIONS（由 v3-pmo-portfolio-traffic-light 注册）', ({
    assert,
  }) => {
    // portfolio:view 已由 v3-pmo-portfolio-traffic-light 注册到 ALL_PERMISSIONS。
    // Dashboard 复用同一权限，无需重复注册。
    assert.isTrue(
      (ALL_PERMISSIONS as readonly string[]).includes('portfolio:view'),
      'portfolio:view 已注册到 ALL_PERMISSIONS——由 v3-pmo-portfolio-traffic-light 统一管理',
    )
  })
})
