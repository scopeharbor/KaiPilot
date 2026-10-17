import { test } from '@japa/runner'
import PmoInvestmentDistributionPolicy from '#policies/pmo_investment_distribution_policy'
import { ALL_PERMISSIONS } from '#rbac'

test.group('PmoInvestmentDistributionPolicy', () => {
  test('复用 portfolio:view 和 resource:view 权限', ({ assert }) => {
    assert.isTrue((ALL_PERMISSIONS as readonly string[]).includes('portfolio:view'))
    assert.isTrue((ALL_PERMISSIONS as readonly string[]).includes('resource:view'))
  })

  test('canView/canViewResourceFacts 调用 RBAC', async ({ assert }) => {
    const calls: string[] = []
    const rbac = {
      async check(_user: unknown, permission: string) {
        calls.push(permission)
        return { allowed: permission === 'portfolio:view' || permission === 'resource:view' }
      },
    }
    const policy = new PmoInvestmentDistributionPolicy(rbac as any)
    const user = { id: 1, isSuperAdmin: false } as any

    assert.isTrue(await policy.canView(user, 1))
    assert.isTrue(await policy.canViewResourceFacts(user, 1))
    assert.deepEqual(calls, ['portfolio:view', 'resource:view'])
  })

  test('authorizeView 拒绝时抛出 PERMISSION_DENIED', async ({ assert }) => {
    const rbac = {
      async check() {
        return { allowed: false }
      },
    }
    const policy = new PmoInvestmentDistributionPolicy(rbac as any)

    await assert.rejects(
      () => policy.authorizeView({ id: 1, isSuperAdmin: false } as any, 1),
      /无权查看 PMO 投入分布/,
    )
  })

  test('manager/department 维度需要资源权限', async ({ assert }) => {
    const rbac = {
      async check(_user: unknown, permission: string) {
        return { allowed: permission === 'portfolio:view' }
      },
    }
    const policy = new PmoInvestmentDistributionPolicy(rbac as any)
    const user = { id: 1, isSuperAdmin: false } as any

    assert.isFalse(await policy.canViewDimension(user, 1, 'manager'))
    assert.isFalse(await policy.canViewDimension(user, 1, 'department'))
    assert.isTrue(await policy.canViewDimension(user, 1, 'status'))
  })
})
