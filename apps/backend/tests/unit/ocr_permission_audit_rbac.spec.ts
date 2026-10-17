import { test } from '@japa/runner'
import {
  ALL_PERMISSIONS,
  CanonicalRole,
  OCR_PERMISSION_AUDIT_AUDIT_READ,
  OCR_PERMISSION_AUDIT_VIEW_STATUS,
  getRolePermissionSet,
  isPermission,
  rolesForPermission,
} from '#rbac'

/**
 * OCR 权限与审计 RBAC 注册测试（v3-ocr-permission-and-audit §3.3）。
 *
 * 覆盖：默认拒绝、权限登记、最简权限角色映射、系统管理员旁路（走既有
 * isSuperAdmin 行为，而非注册表）、以及无硬编码角色判断（策略基于权限判定）。
 */
test.group('OCR 权限/审计 RBAC 注册', () => {
  test('默认拒绝：未登记权限 isPermission 返回 false', ({ assert }) => {
    assert.isFalse(isPermission('ocr_permission_audit:not_registered'))
    assert.isFalse(isPermission('ocr_permission_audit:execute'))
  })

  test('两个 OCR 权限/审计权限均已登记并进入 ALL_PERMISSIONS', ({ assert }) => {
    assert.isTrue(isPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS))
    assert.isTrue(isPermission(OCR_PERMISSION_AUDIT_AUDIT_READ))
    assert.include(ALL_PERMISSIONS, OCR_PERMISSION_AUDIT_VIEW_STATUS)
    assert.include(ALL_PERMISSIONS, OCR_PERMISSION_AUDIT_AUDIT_READ)
  })
})

test.group('OCR 权限/审计角色映射（最简权限）', () => {
  test('view_status：除系统管理员外所有角色均可查看', ({ assert }) => {
    assert.include(rolesForPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS), CanonicalRole.ORG_ADMIN)
    assert.include(
      rolesForPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS),
      CanonicalRole.PROJECT_MANAGER,
    )
    assert.include(rolesForPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS), CanonicalRole.MEMBER)
    assert.include(
      rolesForPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS),
      CanonicalRole.EXTERNAL_COLLABORATOR,
    )
    assert.include(
      rolesForPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS),
      CanonicalRole.READONLY_OBSERVER,
    )
    // 系统管理员走 isSuperAdmin 旁路，不因注册表授权
    assert.notInclude(
      rolesForPermission(OCR_PERMISSION_AUDIT_VIEW_STATUS),
      CanonicalRole.SYSTEM_ADMIN,
    )
  })

  test('audit_read：仅 org_admin / project_manager / readonly_observer，排除 member 与 external', ({
    assert,
  }) => {
    assert.include(rolesForPermission(OCR_PERMISSION_AUDIT_AUDIT_READ), CanonicalRole.ORG_ADMIN)
    assert.include(
      rolesForPermission(OCR_PERMISSION_AUDIT_AUDIT_READ),
      CanonicalRole.PROJECT_MANAGER,
    )
    assert.include(
      rolesForPermission(OCR_PERMISSION_AUDIT_AUDIT_READ),
      CanonicalRole.READONLY_OBSERVER,
    )
    assert.notInclude(rolesForPermission(OCR_PERMISSION_AUDIT_AUDIT_READ), CanonicalRole.MEMBER)
    assert.notInclude(
      rolesForPermission(OCR_PERMISSION_AUDIT_AUDIT_READ),
      CanonicalRole.EXTERNAL_COLLABORATOR,
    )
  })

  test('member 仅 view_status，无 audit_read（最简权限）', ({ assert }) => {
    const member = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isTrue(member.has(OCR_PERMISSION_AUDIT_VIEW_STATUS))
    assert.isFalse(member.has(OCR_PERMISSION_AUDIT_AUDIT_READ))
  })

  test('external_collaborator 仅 view_status，隐藏审计读', ({ assert }) => {
    const ext = getRolePermissionSet(CanonicalRole.EXTERNAL_COLLABORATOR)
    assert.isTrue(ext.has(OCR_PERMISSION_AUDIT_VIEW_STATUS))
    assert.isFalse(ext.has(OCR_PERMISSION_AUDIT_AUDIT_READ))
  })

  test('readonly_observer 可 view_status + audit_read（低敏感只读）', ({ assert }) => {
    const readonly = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isTrue(readonly.has(OCR_PERMISSION_AUDIT_VIEW_STATUS))
    assert.isTrue(readonly.has(OCR_PERMISSION_AUDIT_AUDIT_READ))
  })

  test('org_admin / project_manager 同时拥有两个权限', ({ assert }) => {
    const org = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    const pm = getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    assert.isTrue(org.has(OCR_PERMISSION_AUDIT_VIEW_STATUS))
    assert.isTrue(org.has(OCR_PERMISSION_AUDIT_AUDIT_READ))
    assert.isTrue(pm.has(OCR_PERMISSION_AUDIT_VIEW_STATUS))
    assert.isTrue(pm.has(OCR_PERMISSION_AUDIT_AUDIT_READ))
  })
})

test.group('OCR 权限/审计无硬编码角色判断', () => {
  test('OcrPermissionAuditPolicy 基于权限判定而非角色字面量', async ({ assert }) => {
    // 断言策略源码不引用 CanonicalRole 角色名做分支，而是走 hasPermission。
    const policy = await import('../../app/policies/ocr_permission_audit_policy.js')
    const src = policy.default.toString()
    assert.include(src, 'hasPermission')
    assert.notInclude(src, 'CanonicalRole')
    assert.notInclude(src, "'project_manager'")
    assert.notInclude(src, "'system_admin'")
  })
})
