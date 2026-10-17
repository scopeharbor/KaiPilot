import { test } from '@japa/runner'
import { CanonicalRole, getRolePermissionSet } from '#start/rbac/roles'
import { DIAGRAM_VIEW, DIAGRAM_MANAGE } from '#rbac'

/**
 * DiagramPolicy - RBAC 角色权限映射（fix-v1-runtime-bugs tasks 7.2）。
 *
 * 回归护栏：`diagram:view`/`diagram:manage` 一度定义并被 policy/路由使用，却未纳入
 * 任何规范角色的权限集，导致除系统管理员外所有人访问图表接口一律 403。此处锁定修复后
 * 的静态映射——授予范围与 WBS/甘特「查看-管理」一致——防止后续误改 roles.ts 再次静默丢权。
 */
test.group('DiagramPolicy - RBAC 角色权限矩阵', () => {
  test('org_admin：view + manage 全通', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    assert.isTrue(perms.has(DIAGRAM_VIEW))
    assert.isTrue(perms.has(DIAGRAM_MANAGE))
  })

  test('project_manager：view + manage 全通', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    assert.isTrue(perms.has(DIAGRAM_VIEW))
    assert.isTrue(perms.has(DIAGRAM_MANAGE))
  })

  test('member：仅 view，无 manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isTrue(perms.has(DIAGRAM_VIEW))
    assert.isFalse(perms.has(DIAGRAM_MANAGE))
  })

  test('external_collaborator：仅 view，无 manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.EXTERNAL_COLLABORATOR)
    assert.isTrue(perms.has(DIAGRAM_VIEW))
    assert.isFalse(perms.has(DIAGRAM_MANAGE))
  })

  test('readonly_observer：仅 view，无 manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isTrue(perms.has(DIAGRAM_VIEW))
    assert.isFalse(perms.has(DIAGRAM_MANAGE))
  })
})

/**
 * 直接单测 authorize* 分支：功能层已通过 controller 走过 happy path 与 403 路径，
 * 但覆盖率工具无法从 controller 反溯到 Policy 内部的 throw 行；此处用 stub 拉起
 * DiagramPolicy 本体，两条分支各走一次。
 */
test.group('DiagramPolicy - authorize* 分支覆盖', () => {
  async function makePolicy(allowed: boolean, isSuperAdmin = false) {
    const { default: DiagramPolicy } = await import('#policies/diagram_policy')
    const stubRbac = {
      async check() {
        return { allowed }
      },
    } as any
    const policy = new DiagramPolicy(stubRbac)
    const user = { isSuperAdmin } as any
    return { policy, user }
  }

  test('view / manage —— allowed 全通', async ({ assert }) => {
    const { policy, user } = await makePolicy(true)
    assert.isTrue(await policy.view(user, 1, 1))
    assert.isTrue(await policy.manage(user, 1, 1))
    await policy.authorizeView(user, 1, 1)
    await policy.authorizeManage(user, 1, 1)
  })

  test('super admin：allows 早退返回 true', async ({ assert }) => {
    const { policy, user } = await makePolicy(false, true)
    assert.isTrue(await policy.view(user, 1, 1))
    assert.isTrue(await policy.manage(user, 1, 1))
  })

  test('denied：authorize* 全部抛 PermissionDeniedException', async ({ assert }) => {
    const { policy, user } = await makePolicy(false)
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    await assert.rejects(() => policy.authorizeView(user, 1, 1), PermissionDeniedException as any)
    await assert.rejects(() => policy.authorizeManage(user, 1, 1), PermissionDeniedException as any)
  })
})
