import { test } from '@japa/runner'
import { CanonicalRole, ROLE_PERMISSIONS } from '#rbac/roles'
import {
  PLUGIN_REGISTRY_VIEW,
  PLUGIN_REGISTRY_SUBMIT,
  PLUGIN_REGISTRY_REVIEW,
  PLUGIN_REGISTRY_MANAGE,
  PLUGIN_REGISTRY_ROLLBACK,
} from '#rbac/permissions'

/**
 * v3-plugin-private-registry-lifecycle — 权限矩阵（task 5.2）。
 *
 * spec：「系统 MUST 分离 view/submit/review/manage/rollback 权限」，且
 * 「前端隐藏、客户端角色或插件自报权限 MUST NOT 作为授权依据」。
 *
 * 本文件断言**六个规范角色**在 RBAC catalog 里的静态授予关系。
 * 运行期授权（membership freshness、跨组织、伪造角色）由 `PluginRegistryPolicy`
 * 经 `RbacService` 求值，其行为在 `plugin_registry_authorization.spec.ts` 覆盖。
 */

const REGISTRY_PERMISSIONS = [
  PLUGIN_REGISTRY_VIEW,
  PLUGIN_REGISTRY_SUBMIT,
  PLUGIN_REGISTRY_REVIEW,
  PLUGIN_REGISTRY_MANAGE,
  PLUGIN_REGISTRY_ROLLBACK,
] as const

/** 期望矩阵：角色 → 该角色应持有的私有目录权限集合。 */
const EXPECTED: Record<CanonicalRole, readonly string[]> = {
  // 系统管理员**不逐条枚举**权限：走 `RbacService` 的 isSuperAdmin 短路（见下方专项用例），
  // 因此其 catalog 里不含私有目录权限码——这是既有语义，不是遗漏。
  [CanonicalRole.SYSTEM_ADMIN]: [],
  // 组织管理员持全量（含 rollback）
  [CanonicalRole.ORG_ADMIN]: REGISTRY_PERMISSIONS,
  // 项目经理可看可送审，但**不可**自行审批/管理/回滚（maker-checker 的静态前提）
  [CanonicalRole.PROJECT_MANAGER]: [PLUGIN_REGISTRY_VIEW, PLUGIN_REGISTRY_SUBMIT],
  // 成员只读
  [CanonicalRole.MEMBER]: [PLUGIN_REGISTRY_VIEW],
  // 外部协作者只读（目录条目本身是低敏元数据，不含包体与 manifest）
  [CanonicalRole.EXTERNAL_COLLABORATOR]: [PLUGIN_REGISTRY_VIEW],
  // 只读观察者只读
  [CanonicalRole.READONLY_OBSERVER]: [PLUGIN_REGISTRY_VIEW],
}

test.group('PluginRegistry 权限矩阵（六角色）', () => {
  test('五个权限码互相独立，未被合并成单一权限', ({ assert }) => {
    const unique = new Set(REGISTRY_PERMISSIONS)
    assert.equal(unique.size, 5)
    for (const permission of REGISTRY_PERMISSIONS) {
      assert.match(permission, /^plugin_registry:(view|submit|review|manage|rollback)$/)
    }
  })

  for (const role of Object.values(CanonicalRole)) {
    test(`${role} 的私有目录权限与期望矩阵一致`, ({ assert }) => {
      const granted = (ROLE_PERMISSIONS[role] as readonly string[]).filter((p) =>
        (REGISTRY_PERMISSIONS as readonly string[]).includes(p),
      )
      assert.deepEqual(
        [...granted].sort(),
        [...EXPECTED[role]].sort(),
        `角色 ${role} 的私有目录权限与期望不符`,
      )
    })
  }

  test('审批权限不下放给送审角色（maker-checker 的静态前提）', ({ assert }) => {
    const pm = ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER] as readonly string[]
    assert.include(pm, PLUGIN_REGISTRY_SUBMIT)
    assert.notInclude(pm, PLUGIN_REGISTRY_REVIEW, '送审角色不得同时持有审批权限')
  })

  test('回滚权限只授予管理员（不随 review 一并下放）', ({ assert }) => {
    for (const role of [
      CanonicalRole.PROJECT_MANAGER,
      CanonicalRole.MEMBER,
      CanonicalRole.EXTERNAL_COLLABORATOR,
      CanonicalRole.READONLY_OBSERVER,
    ]) {
      assert.notInclude(
        ROLE_PERMISSIONS[role] as readonly string[],
        PLUGIN_REGISTRY_ROLLBACK,
        `角色 ${role} 不应持有回滚权限`,
      )
    }
  })

  test('system_admin 经 isSuperAdmin 短路授权，而非在 catalog 里逐条枚举', async ({ assert }) => {
    const { default: RbacService } = await import('#services/rbac_service')
    const rbac = new RbacService()
    const superAdmin = { isSuperAdmin: true } as never

    for (const permission of REGISTRY_PERMISSIONS) {
      const result = await rbac.check(superAdmin, permission, 1)
      assert.isTrue(result.allowed, `${permission} 应对 super admin 放行`)
      assert.equal(result.reason, 'system_admin')
    }
  })

  test('只读角色不得持有任何写向权限', ({ assert }) => {
    for (const role of [CanonicalRole.READONLY_OBSERVER, CanonicalRole.MEMBER]) {
      const granted = ROLE_PERMISSIONS[role] as readonly string[]
      for (const write of [
        PLUGIN_REGISTRY_SUBMIT,
        PLUGIN_REGISTRY_REVIEW,
        PLUGIN_REGISTRY_MANAGE,
        PLUGIN_REGISTRY_ROLLBACK,
      ]) {
        assert.notInclude(granted, write, `角色 ${role} 不应持有 ${write}`)
      }
    }
  })
})
