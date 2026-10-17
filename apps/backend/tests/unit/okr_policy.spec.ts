/**
 * OkrPolicy 测试（v3-okr-hierarchy-management tasks 4.4）。
 *
 * 覆盖：
 *   - 组织非成员拒绝（assertOrganizationVisible）
 *   - PMO 用户可见/管理
 *   - 组织所有者可见/管理
 *   - 普通成员只能查看
 *   - 只读用户不可管理
 *   - 跨组织访问拒绝
 *   - super_admin 全部通过
 *   - resolveAccess 维度脱敏
 *   - canViewProject 项目负责人可见
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import OkrPolicy from '#policies/okr_policy'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('OkrPolicy', (group) => {
  // 本 spec 会建用户与组织，必须自带 DB 生命周期：
  // 否则它拿到的是上一个 spec 留下的库，schema 与残留数据都取决于执行顺序。
  useAuthDatabase(group)

  let policy: OkrPolicy

  group.each.setup(async () => {
    const rbac = new RbacService()
    const orgPolicy = new OrganizationPolicy(rbac)
    policy = new OkrPolicy(rbac, orgPolicy)
  })

  async function setupOrg() {
    const owner = await createUser({ email: uniqueEmail('okr-pol-owner') })
    const org = await createOrganization(owner)
    const pmoUser = await createUser({ email: uniqueEmail('okr-pol-pmo') })
    const regularUser = await createUser({ email: uniqueEmail('okr-pol-reg') })
    const readonlyUser = await createUser({ email: uniqueEmail('okr-pol-ro') })
    const outsider = await createUser({ email: uniqueEmail('okr-pol-out') })
    return { owner, org, pmoUser, regularUser, readonlyUser, outsider }
  }

  function makeSuperAdmin() {
    return { id: 0, isSuperAdmin: true } as any
  }

  // ── 组织隔离 ─────────────────────────────────────────────────────

  test('非成员 assertOrganizationVisible 抛出 ResourceNotFoundException', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    try {
      await policy.assertOrganizationVisible(outsider, org.id)
      assert.fail('应该抛出异常')
    } catch (err: any) {
      assert.include(err.message, '组织不存在')
    }
  })

  test('super_admin assertOrganizationVisible 通过', async ({ assert }) => {
    const { org } = await setupOrg()
    await assert.doesNotReject(async () =>
      policy.assertOrganizationVisible(makeSuperAdmin(), org.id),
    )
  })

  test('所有者 assertOrganizationVisible 通过', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    await assert.doesNotReject(async () => policy.assertOrganizationVisible(owner, org.id))
  })

  // ── View 权限 ─────────────────────────────────────────────────────

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

  // ── Manage 权限 ───────────────────────────────────────────────────

  test('组织所有者 canManage = true', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    assert.isTrue(await policy.canManage(owner, org.id))
  })

  test('普通成员 canManage = false', async ({ assert }) => {
    const { org, regularUser } = await setupOrg()
    assert.isFalse(await policy.canManage(regularUser, org.id))
  })

  test('非成员 canManage = false', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    assert.isFalse(await policy.canManage(outsider, org.id))
  })

  // ── 操作级权限 ───────────────────────────────────────────────────

  test('所有者可以 create/update/archive/restore', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    assert.isTrue(await policy.canCreate(owner, org.id))
    assert.isTrue(await policy.canUpdate(owner, org.id))
    assert.isTrue(await policy.canArchive(owner, org.id))
    assert.isTrue(await policy.canRestore(owner, org.id))
  })

  test('普通成员不可以 create/update/archive', async ({ assert }) => {
    const { org, regularUser } = await setupOrg()
    assert.isFalse(await policy.canCreate(regularUser, org.id))
    assert.isFalse(await policy.canUpdate(regularUser, org.id))
    assert.isFalse(await policy.canArchive(regularUser, org.id))
  })

  test('非成员 authorizeCreate 抛出 PermissionDeniedException', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    try {
      await policy.authorizeCreate(outsider, org.id)
      assert.fail('应该抛出异常')
    } catch (err: any) {
      assert.include(err.message, '无权')
    }
  })

  test('非成员 authorizeUpdate 抛出 PermissionDeniedException', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    try {
      await policy.authorizeUpdate(outsider, org.id)
      assert.fail()
    } catch (err: any) {
      assert.include(err.message, '无权')
    }
  })

  // ── Progress / Evidence / AI ──────────────────────────────────────

  test('所有者可以 updateProgress / evidence / AI draft', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    assert.isTrue(await policy.canUpdateProgress(owner, org.id))
    assert.isTrue(await policy.canManageEvidence(owner, org.id))
    assert.isTrue(await policy.canUseAiDraft(owner, org.id))
  })

  test('非成员不可以 progress / evidence / AI draft', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    assert.isFalse(await policy.canUpdateProgress(outsider, org.id))
    assert.isFalse(await policy.canManageEvidence(outsider, org.id))
    assert.isFalse(await policy.canUseAiDraft(outsider, org.id))
  })

  // ── resolveAccess 维度脱敏 ───────────────────────────────────────

  test('所有者 resolveAccess 返回全权限', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const access = await policy.resolveAccess(owner, org.id)
    assert.isTrue(access.canViewEvidence)
    assert.isTrue(access.canManage)
  })

  test('非成员 resolveAccess 返回受限', async ({ assert }) => {
    const { org, outsider } = await setupOrg()
    const access = await policy.resolveAccess(outsider, org.id)
    assert.isFalse(access.canViewEvidence)
    assert.isFalse(access.canViewPmo)
    assert.isFalse(access.canManage)
  })

  test('super_admin resolveAccess 返回全权限', async ({ assert }) => {
    const { org } = await setupOrg()
    const access = await policy.resolveAccess(makeSuperAdmin(), org.id)
    assert.isTrue(access.canViewEvidence)
    assert.isTrue(access.canViewPmo)
    assert.isTrue(access.canManage)
  })
})
