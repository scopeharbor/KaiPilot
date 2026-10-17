/**
 * DocumentSearchPolicy 测试（v3-document-full-text-search §4.4）
 *
 * 注：本文件原先把权限桩打在 `user.hasPermission` 上——User 模型没有该方法，
 * 桩只是在实例上凭空造了一个属性，测试因此从未验证过真实判定链。
 * 现改为桩 `RbacService.resolveUserPermissions`，与 policy 实际依赖一致。
 */
import { test } from '@japa/runner'
import DocumentSearchPolicy from '#policies/document_search_policy'
import User from '#models/user'
import type RbacService from '#services/rbac_service'
import { DOCUMENT_SEARCH_VIEW, DOCUMENT_SEARCH_MANAGE } from '#start/rbac/permissions'
import type { Permission } from '#start/rbac/permissions'

/** 造一个只回答固定权限集的 RbacService 替身。 */
function policyWithPermissions(permissions: Permission[]): DocumentSearchPolicy {
  const rbac = {
    resolveUserPermissions: async () => permissions,
  } as unknown as RbacService
  return new DocumentSearchPolicy(rbac)
}

test.group('DocumentSearchPolicy', () => {
  test('resolveScope 返回空数组当用户不在该组织', async ({ assert }) => {
    const policy = policyWithPermissions([DOCUMENT_SEARCH_VIEW])
    const user = new User()
    // 未设置 organizationMembers → resolveScope 应返回 []
    user.related = () =>
      ({
        organizationMembers: () => ({
          query: () => ({ where: () => ({ first: async () => null }) }),
        }),
        projectMembers: () => ({ query: () => ({ whereHas: () => [] }) }),
      }) as any
    user.id = 999

    const scope = await policy.resolveScope(user, 1)
    assert.deepEqual(scope, [])
  })

  test('view 通过 RbacService 检查 document_search:view', async ({ assert }) => {
    const policy = policyWithPermissions([DOCUMENT_SEARCH_VIEW])
    const canView = await policy.view(new User(), 1)
    assert.isTrue(canView)
  })

  test('view 返回 false 当用户无 document_search:view', async ({ assert }) => {
    const policy = policyWithPermissions([])
    const canView = await policy.view(new User(), 1)
    assert.isFalse(canView)
  })

  test('manage 通过 RbacService 检查 document_search:manage', async ({ assert }) => {
    const policy = policyWithPermissions([DOCUMENT_SEARCH_MANAGE])
    const canManage = await policy.manage(new User(), 1)
    assert.isTrue(canManage)
  })

  test('manage 返回 false 当用户仅有 view 权限', async ({ assert }) => {
    const policy = policyWithPermissions([DOCUMENT_SEARCH_VIEW])
    const canManage = await policy.manage(new User(), 1)
    assert.isFalse(canManage)
  })

  test('system:admin 哨兵放行任意文档搜索权限', async ({ assert }) => {
    const policy = policyWithPermissions(['system:admin' as Permission])
    assert.isTrue(await policy.view(new User(), 1))
    assert.isTrue(await policy.manage(new User(), 1))
  })
})
