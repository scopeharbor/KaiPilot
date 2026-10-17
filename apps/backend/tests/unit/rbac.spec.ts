import { test } from '@japa/runner'
import {
  ALL_PERMISSIONS,
  AI_CONFIRM,
  CanonicalRole,
  DIAGRAM_MANAGE,
  DIAGRAM_VIEW,
  OrganizationMemberRole,
  ProjectRoleName,
  PROJECT_VIEW,
  ROLE_PERMISSIONS,
  SYSTEM_ADMIN,
  TASK_UPDATE_SELF,
  canonicalRoleFromOrganizationRole,
  canonicalRoleFromProjectRole,
  getRolePermissionSet,
  isPermission,
  rolesForPermission,
} from '#rbac'

/**
 * 任务 2.4 — 权限注册表与角色→权限集映射单元测试。
 */
test.group('RBAC 权限注册表', () => {
  test('ALL_PERMISSIONS 无重复且 isPermission 守卫正确', ({ assert }) => {
    const set = new Set(ALL_PERMISSIONS)
    assert.equal(set.size, ALL_PERMISSIONS.length, '权限常量不应重复')
    assert.isTrue(isPermission('task:view'))
    assert.isFalse(isPermission('task:nonexistent'))
    assert.isFalse(isPermission(''))
  })

  test('每个角色的权限集均为已登记权限', ({ assert }) => {
    for (const role of Object.values(CanonicalRole)) {
      for (const p of getRolePermissionSet(role)) {
        assert.isTrue(isPermission(p), `角色 ${role} 的权限 ${p} 应已登记`)
      }
    }
  })

  /**
   * 断言精确集合而不是裸计数。
   *
   * 原实现只断言 `length === 6`：`fb3a289d`（发布信任与证据中心）把
   * `release_trust_center:view` 加进本角色却没同步这个数字，断言就此长期红着——
   * 而裸计数即便同步了也看不出**加的是哪个权限**。这是授权红线角色，
   * 任何新增都应在 diff 里直接可读、可复核。新增权限时请连同下面的清单一起改。
   */
  test('系统管理员的权限集与登记清单逐项一致', ({ assert }) => {
    const set = getRolePermissionSet(CanonicalRole.SYSTEM_ADMIN)
    assert.isTrue(set.has(SYSTEM_ADMIN), 'system:admin 哨兵权限必须在集合内')

    assert.deepEqual([...ROLE_PERMISSIONS[CanonicalRole.SYSTEM_ADMIN]].sort(), [
      'pdm:migration:dry_run',
      'pdm:migration:execute',
      'pdm:migration:plan',
      'pdm:migration:read',
      'pdm:migration:rollback',
      'system:admin',
    ])
  })

  test('组织角色解析：owner/admin→org_admin，member→member，viewer→readonly', ({ assert }) => {
    assert.equal(
      canonicalRoleFromOrganizationRole(OrganizationMemberRole.OWNER),
      CanonicalRole.ORG_ADMIN,
    )
    assert.equal(
      canonicalRoleFromOrganizationRole(OrganizationMemberRole.ADMIN),
      CanonicalRole.ORG_ADMIN,
    )
    assert.equal(
      canonicalRoleFromOrganizationRole(OrganizationMemberRole.MEMBER),
      CanonicalRole.MEMBER,
    )
    assert.equal(
      canonicalRoleFromOrganizationRole(OrganizationMemberRole.VIEWER),
      CanonicalRole.READONLY_OBSERVER,
    )
    assert.isNull(canonicalRoleFromOrganizationRole('unknown'))
  })

  test('项目角色解析：Owner/PM→project_manager，其余按名映射', ({ assert }) => {
    assert.equal(canonicalRoleFromProjectRole(ProjectRoleName.OWNER), CanonicalRole.PROJECT_MANAGER)
    assert.equal(
      canonicalRoleFromProjectRole(ProjectRoleName.PROJECT_MANAGER),
      CanonicalRole.PROJECT_MANAGER,
    )
    assert.equal(canonicalRoleFromProjectRole(ProjectRoleName.MEMBER), CanonicalRole.MEMBER)
    assert.equal(
      canonicalRoleFromProjectRole(ProjectRoleName.EXTERNAL_COLLABORATOR),
      CanonicalRole.EXTERNAL_COLLABORATOR,
    )
    assert.equal(
      canonicalRoleFromProjectRole(ProjectRoleName.READONLY_OBSERVER),
      CanonicalRole.READONLY_OBSERVER,
    )
    assert.isNull(canonicalRoleFromProjectRole('Random Role'))
  })

  test('最小权限：只读观察者不含写权限，成员仅可改自己任务', ({ assert }) => {
    const observer = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isTrue(observer.has(PROJECT_VIEW))
    assert.isFalse(observer.has(TASK_UPDATE_SELF))

    const member = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isTrue(member.has(TASK_UPDATE_SELF))
    assert.isFalse(member.has('task:update' as never), '成员不应有全量 task:update')
  })

  test('取交集：组织成员 ∩ 项目只读 = 仅双方共有权限（最小权限）', ({ assert }) => {
    const orgMember = getRolePermissionSet(CanonicalRole.MEMBER)
    const projectObserver = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    const intersection = [...orgMember].filter((p) => projectObserver.has(p))

    // project:view 双方都有 → 保留
    assert.include(intersection, PROJECT_VIEW)
    // ai:trigger 仅组织成员有 → 交集剔除
    assert.notInclude(intersection, AI_CONFIRM)
    assert.notInclude(intersection, 'ai:trigger')
  })

  test('图表权限：管理角色具查看+管理，普通/受限角色仅查看', ({ assert }) => {
    // org_admin / project_manager：查看 + 管理
    for (const role of [CanonicalRole.ORG_ADMIN, CanonicalRole.PROJECT_MANAGER]) {
      const set = getRolePermissionSet(role)
      assert.isTrue(set.has(DIAGRAM_VIEW), `${role} 应具 diagram:view`)
      assert.isTrue(set.has(DIAGRAM_MANAGE), `${role} 应具 diagram:manage`)
    }
    // member / external_collaborator / readonly_observer：仅查看，缺管理
    for (const role of [
      CanonicalRole.MEMBER,
      CanonicalRole.EXTERNAL_COLLABORATOR,
      CanonicalRole.READONLY_OBSERVER,
    ]) {
      const set = getRolePermissionSet(role)
      assert.isTrue(set.has(DIAGRAM_VIEW), `${role} 应具 diagram:view`)
      assert.isFalse(set.has(DIAGRAM_MANAGE), `${role} 不应具 diagram:manage`)
    }
    // 反查：diagram:manage 的角色集含管理角色、不含只读
    const managers = rolesForPermission(DIAGRAM_MANAGE)
    assert.include(managers, CanonicalRole.ORG_ADMIN)
    assert.include(managers, CanonicalRole.PROJECT_MANAGER)
    assert.notInclude(managers, CanonicalRole.READONLY_OBSERVER)
  })

  test('反查：rolesForPermission 返回所有拥有该权限的角色', ({ assert }) => {
    const viewers = rolesForPermission(PROJECT_VIEW)
    assert.include(viewers, CanonicalRole.READONLY_OBSERVER)
    assert.include(viewers, CanonicalRole.MEMBER)
    assert.include(viewers, CanonicalRole.ORG_ADMIN)
    // 系统管理员权限集只含哨兵，不含逐条业务权限
    assert.notInclude(viewers, CanonicalRole.SYSTEM_ADMIN)
  })

  test('默认拒绝：未知权限无任何角色命中', ({ assert }) => {
    assert.lengthOf(rolesForPermission('nonexistent:permission' as never), 0)
  })
})
