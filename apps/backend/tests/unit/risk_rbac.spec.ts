import { test } from '@japa/runner'
import {
  ALL_PERMISSIONS,
  CanonicalRole,
  RISK_MANAGE,
  RISK_VIEW,
  RISK_UPDATE_OWN,
  getRolePermissionSet,
  isPermission,
  rolesForPermission,
} from '#rbac'

test.group('风险 RBAC 权限注册', () => {
  test('risk:view / risk:manage / risk:update_own 已登记', ({ assert }) => {
    assert.isTrue(isPermission('risk:view'))
    assert.isTrue(isPermission('risk:manage'))
    assert.isTrue(isPermission('risk:update_own'))
  })

  test('三个风险权限均在 ALL_PERMISSIONS 中', ({ assert }) => {
    assert.include(ALL_PERMISSIONS, RISK_VIEW)
    assert.include(ALL_PERMISSIONS, RISK_MANAGE)
    assert.include(ALL_PERMISSIONS, RISK_UPDATE_OWN)
  })
})

test.group('风险角色权限映射', () => {
  test('Owner/PM 拥有 risk:manage', ({ assert }) => {
    const ownerPerms = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    const pmPerms = getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    assert.isTrue(ownerPerms.has(RISK_MANAGE))
    assert.isTrue(pmPerms.has(RISK_MANAGE))
  })

  test('Member 拥有 risk:view + risk:update_own，无 risk:manage', ({ assert }) => {
    const memberPerms = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isTrue(memberPerms.has(RISK_VIEW))
    assert.isTrue(memberPerms.has(RISK_UPDATE_OWN))
    assert.isFalse(memberPerms.has(RISK_MANAGE))
  })

  test('Readonly 拥有 risk:view，无 manage/update_own', ({ assert }) => {
    const readonlyPerms = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isTrue(readonlyPerms.has(RISK_VIEW))
    assert.isFalse(readonlyPerms.has(RISK_MANAGE))
    assert.isFalse(readonlyPerms.has(RISK_UPDATE_OWN))
  })

  test('External 拥有 risk:view', ({ assert }) => {
    const extPerms = getRolePermissionSet(CanonicalRole.EXTERNAL_COLLABORATOR)
    assert.isTrue(extPerms.has(RISK_VIEW))
    assert.isFalse(extPerms.has(RISK_MANAGE))
  })

  test('rolesForPermission(risk:manage) 返回 Owner/PM', ({ assert }) => {
    const roles = rolesForPermission(RISK_MANAGE)
    assert.include(roles, CanonicalRole.ORG_ADMIN)
    assert.include(roles, CanonicalRole.PROJECT_MANAGER)
    assert.notInclude(roles, CanonicalRole.MEMBER)
    assert.notInclude(roles, CanonicalRole.READONLY_OBSERVER)
  })

  test('rolesForPermission(risk:update_own) 仅返回 Member', ({ assert }) => {
    const roles = rolesForPermission(RISK_UPDATE_OWN)
    assert.include(roles, CanonicalRole.MEMBER)
    assert.notInclude(roles, CanonicalRole.ORG_ADMIN)
    assert.notInclude(roles, CanonicalRole.PROJECT_MANAGER)
    assert.notInclude(roles, CanonicalRole.READONLY_OBSERVER)
  })

  test('rolesForPermission(risk:view) 包含所有非系统管理员角色', ({ assert }) => {
    const roles = rolesForPermission(RISK_VIEW)
    assert.include(roles, CanonicalRole.ORG_ADMIN)
    assert.include(roles, CanonicalRole.PROJECT_MANAGER)
    assert.include(roles, CanonicalRole.MEMBER)
    assert.include(roles, CanonicalRole.READONLY_OBSERVER)
    assert.include(roles, CanonicalRole.EXTERNAL_COLLABORATOR)
  })
})
