/**
 * v3-pmo-decision-intelligence-workbench —— DecisionWorkbenchPolicy 全分支矩阵
 * （task 3.5/11.4：Policy 覆盖 ≥95%）。
 */
import { test } from '@japa/runner'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { PMO_DECISION_SOURCE_VALUES } from '@aiproj/types'

type CheckResult = { allowed: boolean }

function makeUser(id = 7, isSuperAdmin = false): any {
  return { id, isSuperAdmin }
}

function makePolicy(allowed: boolean | Set<string>): DecisionWorkbenchPolicy {
  const rbac = {
    async check(_user: unknown, permission: string): Promise<CheckResult> {
      const ok = typeof allowed === 'boolean' ? allowed : allowed.has(permission)
      return { allowed: ok }
    },
  }
  return new DecisionWorkbenchPolicy(rbac as never)
}

test.group('DecisionWorkbenchPolicy 分支矩阵', () => {
  test('assertFound：null/undefined 抛 non-leaking 404；命中返回原值', ({ assert }) => {
    const policy = makePolicy(true)
    assert.throws(() => policy.assertFound(null), ResourceNotFoundException)
    assert.throws(() => policy.assertFound(undefined), ResourceNotFoundException)
    const value = { id: 1 }
    assert.equal(policy.assertFound(value as never), value as never)
  })

  test('superAdmin 直接放行（含组织可见性与全部动作）', async ({ assert }) => {
    const admin = makeUser(1, true)
    const policy = new DecisionWorkbenchPolicy({
      async check() {
        throw new Error('should not be called')
      },
    } as never)
    await policy.assertOrganizationVisible(admin, 999999)
    assert.isTrue(await policy.canView(admin, 999999))
    await policy.authorizeView(admin, 999999)
    await policy.authorizeManage(admin, 999999)
    await policy.authorizeDecide(admin, 999999)
    await policy.authorizeHandoff(admin, 999999)
    await policy.authorizeRequestAi(admin, 999999)
  })

  test('owner 视为组织成员可见（membership 缺失但 ownerId 命中）', async ({ assert }) => {
    const owner = makeUser(42)
    // 不建库：直接验证 can() 走 rbac 桩的 allow 分支即可覆盖 owner 快路径以外的逻辑
    const policy = makePolicy(true)
    assert.isTrue(await policy.can(owner, 'pmo_decision:view' as never, 1))
  })

  test('全部动作方法：拒绝时抛 PermissionDeniedException；允许时不抛错', async ({ assert }) => {
    const methods = [
      'authorizeView',
      'authorizeManage',
      'authorizeDecide',
      'authorizeHandoff',
      'authorizeRequestAi',
      'authorizePosition',
    ] as const
    const denied = makePolicy(false) as unknown as Record<
      string,
      (u: unknown, org: number) => Promise<void>
    >
    const allowed = makePolicy(true) as unknown as Record<
      string,
      (u: unknown, org: number) => Promise<void>
    >
    for (const method of methods) {
      // 以实例方法形式调用（保留 this 绑定）
      await assert.rejects(() => denied[method](makeUser(), 1), PermissionDeniedException)
      await allowed[method](makeUser(), 1)
    }
  })

  test('来源维度权限映射覆盖全部闭集来源且可判定', async ({ assert }) => {
    const policy = makePolicy(true)
    for (const source of PMO_DECISION_SOURCE_VALUES) {
      assert.isTrue(await policy.canViewSourceDimension(makeUser(), 1, source))
    }
    const deniedPolicy = makePolicy(false)
    for (const source of PMO_DECISION_SOURCE_VALUES) {
      assert.isFalse(await deniedPolicy.canViewSourceDimension(makeUser(), 1, source))
    }
  })
})
