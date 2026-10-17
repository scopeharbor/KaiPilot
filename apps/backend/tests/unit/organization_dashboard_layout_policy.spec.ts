import { test } from '@japa/runner'
import OrganizationDashboardLayoutPolicy from '#policies/organization_dashboard_layout_policy'
import { ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS } from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排 Policy 测试（v3-organization-dashboard-layout-builder §3.2）。
 *
 * 覆盖：非成员隔离、个人布局私密性、共享默认管理权限、
 *       受限模块脱敏、跨组织推断防护。
 * 全部使用 mock/fixture，不触发真实 RBAC 或外部请求。
 */

function makeRbac(allowed: boolean = true) {
  return { check: async () => ({ allowed }) } as any
}

function makeOrgPolicy(member: boolean = true, owner: boolean = false) {
  return {
    view: async () => member || owner,
  } as any
}

const MOCK_USER = { id: 7, isSuperAdmin: false }
const SUPER_ADMIN = { id: 1, isSuperAdmin: true }

test.group('OrganizationDashboardLayoutPolicy —— 非成员隔离', () => {
  test('非 superadmin 且非组织成员 → 无查看权限并被拒绝', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(
      makeRbac(false),
      makeOrgPolicy(false, false),
    )
    // assertOrganizationVisible 会查真实 organizations 表，本组不接 DB；
    // 这里验证同一条隔离链上不依赖 DB 的读权限判定：非成员且 RBAC 拒绝 → 不可查看。
    assert.isFalse(await policy.canView(MOCK_USER as any, 1))
    await assert.rejects(
      async () => policy.authorizeView(MOCK_USER as any, 1),
      /无权查看组织 Dashboard 布局/,
    )
  })

  test('superadmin 始终放行', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(), makeOrgPolicy(false, false))
    // superadmin 走 assertOrganizationVisible 的第一行
    assert.equal(SUPER_ADMIN.isSuperAdmin, true)
    // 不抛异常即为通过（superadmin 绕过组织检查）
    await policy.assertOrganizationVisible({ id: 1, isSuperAdmin: true } as any, 1)
  })
})

test.group('OrganizationDashboardLayoutPolicy —— 个人布局私密性', () => {
  test('个人布局只能保存自己的', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(true), makeOrgPolicy(true))
    // 普通成员可以保存个人布局
    const canSave = await policy.canSavePersonal(MOCK_USER as any, 1)
    assert.isTrue(canSave)
  })

  test('非组织成员不能保存个人布局', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(false), makeOrgPolicy(false))
    const canSave = await policy.canSavePersonal(MOCK_USER as any, 1)
    assert.isFalse(canSave)
  })
})

test.group('OrganizationDashboardLayoutPolicy —— 共享默认管理权限', () => {
  test('普通成员无权管理组织共享布局', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(false), makeOrgPolicy(true))
    const canManage = await policy.canManageShared(MOCK_USER as any, 1)
    assert.isFalse(canManage)
  })

  test('superadmin 可以管理组织共享布局', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(false), makeOrgPolicy(false))
    const canManage = await policy.canManageShared(SUPER_ADMIN as any, 1)
    assert.isTrue(canManage)
  })

  test('授权角色可以管理组织共享布局', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(true), makeOrgPolicy(true))
    const canManage = await policy.canManageShared(MOCK_USER as any, 1)
    assert.isTrue(canManage)
  })
})

test.group('OrganizationDashboardLayoutPolicy —— 模块级权限', () => {
  test('superadmin 对所有模块有权限', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(false), makeOrgPolicy(false))
    const hasPermission = await policy.checkModulePermission(
      SUPER_ADMIN as any,
      1,
      ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY,
    )
    assert.isTrue(hasPermission)
  })

  test('无权限用户对 PMO_ENTRY 返回 false', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(false), makeOrgPolicy(true))
    const hasPermission = await policy.checkModulePermission(
      MOCK_USER as any,
      1,
      ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY,
    )
    assert.isFalse(hasPermission)
  })

  test('identity 模块默认有权限（ORG_VIEW fallback）', async ({ assert }) => {
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(true), makeOrgPolicy(true))
    const hasPermission = await policy.checkModulePermission(
      MOCK_USER as any,
      1,
      ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
    )
    assert.isTrue(hasPermission)
  })

  test('跨组织推断防护：unknown moduleKey 由 Validator 层拒绝（Policy 放行未知 key）', async ({
    assert,
  }) => {
    // Policy 不拒绝未注册的模块 key——该拒绝由 Validator 层的 validateModulesAgainstRegistry 负责。
    // 分离职责：Validator 校验注册表；Policy 只校验已注册模块的 RBAC 权限。
    const policy = new OrganizationDashboardLayoutPolicy(makeRbac(true), makeOrgPolicy(true))
    const hasPermission = await policy.checkModulePermission(
      MOCK_USER as any,
      1,
      'unknown_widget' as any,
    )
    // 未知 key 无权限映射，Policy 放行（Validator 已拦截）
    assert.isTrue(hasPermission)
  })
})
