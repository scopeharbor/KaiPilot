/**
 * OkrDashboardPolicy 测试（v3-okr-dashboard §3.4）。
 *
 * 覆盖 read-only Dashboard 权限：
 *   - assertOrganizationVisible：非成员 RESOURCE_NOT_FOUND
 *   - canView：所有者 / super_admin / 非成员
 *   - authorizeView：非成员抛异常
 *   - canViewBackflowSummary：继承 OKR view
 *   - canDrillDownProject：继承 OKR project view
 *   - resolveAccess：脱敏后维度访问
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import OkrDashboardPolicy from '#policies/okr_dashboard_policy'
import OkrPolicy from '#policies/okr_policy'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('OkrDashboardPolicy', (group) => {
  // 本 spec 会建用户与组织，必须自带 DB 生命周期：
  // 否则它拿到的是上一个 spec 留下的库，schema 与残留数据都取决于执行顺序。
  useAuthDatabase(group)

  let policy: OkrDashboardPolicy

  group.each.setup(async () => {
    const rbac = new RbacService()
    const orgPolicy = new OrganizationPolicy(rbac)
    const okrPolicy = new OkrPolicy(rbac, orgPolicy)
    policy = new OkrDashboardPolicy(okrPolicy)
  })

  async function setupOrg() {
    const owner = await createUser({ email: uniqueEmail('okr-dash-owner') })
    const org = await createOrganization(owner)
    const regularUser = await createUser({ email: uniqueEmail('okr-dash-reg') })
    const outsider = await createUser({ email: uniqueEmail('okr-dash-out') })
    return { owner, org, regularUser, outsider }
  }

  function makeSuperAdmin() {
    return { id: 0, isSuperAdmin: true } as any
  }

  // ── 组织隔离 ────────────────────────────────────────────────────

  test('非成员 assertOrganizationVisible 抛出 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    try {
      await policy.assertOrganizationVisible(outsider, org.id)
      assert.fail('应该抛出异常')
    } catch (err: any) {
      assert.include(err.message, '组织不存在')
    }
  })

  test('所有者 assertOrganizationVisible 通过', async () => {
    const { org, owner } = await setupOrg()
    await policy.assertOrganizationVisible(owner, org.id)
  })

  test('super_admin assertOrganizationVisible 通过', async () => {
    const { org } = await setupOrg()
    await policy.assertOrganizationVisible(makeSuperAdmin(), org.id)
  })

  // ── View 权限 ───────────────────────────────────────────────────

  test('组织所有者 canView = true', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    assert.isTrue(await policy.canView(owner, org.id))
  })

  test('super_admin canView = true', async ({ assert }) => {
    const { org } = await setupOrg()
    assert.isTrue(await policy.canView(makeSuperAdmin(), org.id))
  })

  test('非成员 canView = false', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    assert.isFalse(await policy.canView(outsider, org.id))
  })

  test('非成员 authorizeView 抛出 PermissionDeniedException', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    try {
      await policy.authorizeView(outsider, org.id)
      assert.fail('应该抛出异常')
    } catch (err: any) {
      assert.include(err.message, '无权')
    }
  })

  // ── Backflow 视图 ────────────────────────────────────────────────

  test('组织所有者 canViewBackflowSummary = true（继承 OKR view）', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    assert.isTrue(await policy.canViewBackflowSummary(owner, org.id))
  })

  test('非成员 canViewBackflowSummary = false', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    assert.isFalse(await policy.canViewBackflowSummary(outsider, org.id))
  })

  // ── drill-down 项目 ─────────────────────────────────────────────

  test('非成员 canDrillDownProject = false（跨组织禁止）', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    // 项目 id 不存在时也不能通过；关键是组织隔离拒绝
    assert.isFalse(await policy.canDrillDownProject(outsider, org.id, 999_999))
  })

  // ── resolveAccess 维度脱敏 ──────────────────────────────────────

  test('所有者 resolveAccess 返回可查看 evidence', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const access = await policy.resolveAccess(owner, org.id)
    assert.isTrue(access.canViewEvidence)
  })

  test('非成员 resolveAccess 返回受限', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    const access = await policy.resolveAccess(outsider, org.id)
    assert.isFalse(access.canViewEvidence)
    assert.isFalse(access.canViewPmo)
  })

  test('super_admin resolveAccess 返回全权限', async ({ assert }) => {
    const { org } = await setupOrg()
    const access = await policy.resolveAccess(makeSuperAdmin(), org.id)
    assert.isTrue(access.canViewEvidence)
    assert.isTrue(access.canViewPmo)
  })
})
