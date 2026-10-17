import { test } from '@japa/runner'
import { CanonicalRole, getRolePermissionSet } from '#start/rbac/roles'

test.group('FilePolicy - RBAC 角色权限映射', () => {
  test('org_admin 拥有 file:view 和 file:manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    assert.isTrue(perms.has('file:view'))
    assert.isTrue(perms.has('file:manage'))
  })

  test('project_manager 拥有 file:view 和 file:manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    assert.isTrue(perms.has('file:view'))
    assert.isTrue(perms.has('file:manage'))
  })

  test('member 拥有 file:view 但没有 file:manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isTrue(perms.has('file:view'))
    assert.isFalse(perms.has('file:manage'))
  })

  test('external_collaborator 拥有 file:view 但没有 file:manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.EXTERNAL_COLLABORATOR)
    assert.isTrue(perms.has('file:view'))
    assert.isFalse(perms.has('file:manage'))
  })

  test('readonly_observer 拥有 file:view 但没有 file:manage', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isTrue(perms.has('file:view'))
    assert.isFalse(perms.has('file:manage'))
  })
})
