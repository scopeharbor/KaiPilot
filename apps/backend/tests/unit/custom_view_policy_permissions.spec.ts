import { test } from '@japa/runner'
import { CanonicalRole, getRolePermissionSet } from '#start/rbac/roles'
import { CUSTOM_VIEW_VIEW, CUSTOM_VIEW_MANAGE } from '#rbac'

/**
 * CustomViewPolicy - RBAC 角色权限映射（tasks 2.7）。
 *
 * 直接检查 `ROLE_PERMISSIONS` 表，避免拉起 DB/HTTP 层。功能层的越权矩阵
 * 已在 `tests/functional/custom_views/custom_views.spec.ts` 覆盖端到端；此处仅锁定
 * "哪些角色具备哪些能力"的静态映射，防止后续误改 roles.ts 时静默改变边界。
 *
 * 自定义视图的 RBAC 路由级权限统一走 TASK_VIEW（视图是任务视图的扩展），
 * 行级管理权限由 CustomViewPolicy 按可见性（personal/shared）和所有者关系判定。
 * custom_view:view/manage 是扩展权限常量，当前未加入 ROLE_PERMISSIONS 的基础角色，
 * 后续若需细化可逐步添加。
 */
test.group('CustomViewPolicy - RBAC 角色权限矩阵', () => {
  test('org_admin：view + manage 均可', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    assert.isTrue(perms.has(CUSTOM_VIEW_VIEW))
    assert.isTrue(perms.has(CUSTOM_VIEW_MANAGE))
  })

  test('project_manager：view + manage 均可', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    assert.isTrue(perms.has(CUSTOM_VIEW_VIEW))
    assert.isTrue(perms.has(CUSTOM_VIEW_MANAGE))
  })

  test('member：view + manage 均不可见（暂不开放自定义视图扩展权限）', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isFalse(perms.has(CUSTOM_VIEW_VIEW))
    assert.isFalse(perms.has(CUSTOM_VIEW_MANAGE))
  })

  test('external_collaborator：无任何 custom_view:* 权限', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.EXTERNAL_COLLABORATOR)
    assert.isFalse(perms.has(CUSTOM_VIEW_VIEW))
    assert.isFalse(perms.has(CUSTOM_VIEW_MANAGE))
  })

  test('readonly_observer：无 custom_view:* 权限', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isFalse(perms.has(CUSTOM_VIEW_VIEW))
    assert.isFalse(perms.has(CUSTOM_VIEW_MANAGE))
  })
})

/**
 * 直接单测 authorize* 分支：功能层已通过 controller 走过 happy path 与 403 路径，
 * 但覆盖率工具无法从 controller 反溯到 Policy 内部的 throw 行；此处用 stub 拉起
 * CustomViewPolicy 本体，把自定义视图权限分支拉满。
 */
test.group('CustomViewPolicy - authorize* 分支覆盖', () => {
  function makePolicy() {
    const stubRbac = {
      async check() {
        return { allowed: true }
      },
    } as any
    return stubRbac
  }

  /**
   * 个人视图场景：Policy 通过所有者关系判定，不依赖 RbacService。
   */
  test('viewPersonal：所有者可见 / 非所有者抛异常', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const policy = new CustomViewPolicy(makePolicy())

    const ownerUser = { user: { id: 1, isSuperAdmin: false } } as any
    const otherUser = { user: { id: 2, isSuperAdmin: false } } as any
    const myView = {
      ownerUserId: 1,
      visibility: 'personal',
      organizationId: 1,
      projectId: 1,
    } as any

    assert.isTrue(await policy.viewPersonal(ownerUser, myView))
    assert.isFalse(await policy.viewPersonal(otherUser, myView))
    await policy.authorizeViewPersonal(ownerUser, myView)
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    await assert.rejects(
      () => policy.authorizeViewPersonal(otherUser, myView),
      PermissionDeniedException as any,
    )
  })

  test('super admin：viewPersonal 早退返回 true', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const policy = new CustomViewPolicy(makePolicy())

    const adminUser = { user: { id: 1, isSuperAdmin: true } } as any
    const someoneElsesView = {
      ownerUserId: 99,
      visibility: 'personal',
      organizationId: 1,
      projectId: 1,
    } as any

    assert.isTrue(await policy.viewPersonal(adminUser, someoneElsesView))
    await policy.authorizeViewPersonal(adminUser, someoneElsesView)
  })

  test('viewShared：有 TASK_VIEW 则通过', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const rbac = {
      async check() {
        return { allowed: true }
      },
    } as any
    const policy = new CustomViewPolicy(rbac)

    const user = { user: { id: 1, isSuperAdmin: false } } as any
    assert.isTrue(await policy.viewShared(user, 1, 1))
    await policy.authorizeViewShared(user, 1, 1)
  })

  test('viewShared：无 TASK_VIEW 抛异常', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const rbac = {
      async check() {
        return { allowed: false }
      },
    } as any
    const policy = new CustomViewPolicy(rbac)

    const user = { user: { id: 1, isSuperAdmin: false } } as any
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    assert.isFalse(await policy.viewShared(user, 1, 1))
    await assert.rejects(
      () => policy.authorizeViewShared(user, 1, 1),
      PermissionDeniedException as any,
    )
  })

  test('create：有 TASK_VIEW 则通过', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const rbac = {
      async check() {
        return { allowed: true }
      },
    } as any
    const policy = new CustomViewPolicy(rbac)

    const user = { user: { id: 1, isSuperAdmin: false } } as any
    assert.isTrue(await policy.create(user, 1, 1))
    await policy.authorizeCreate(user, 1, 1)
  })

  test('create：无 TASK_VIEW 抛异常', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const rbac = {
      async check() {
        return { allowed: false }
      },
    } as any
    const policy = new CustomViewPolicy(rbac)

    const user = { user: { id: 1, isSuperAdmin: false } } as any
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    assert.isFalse(await policy.create(user, 1, 1))
    await assert.rejects(() => policy.authorizeCreate(user, 1, 1), PermissionDeniedException as any)
  })

  test('manage personal：仅所有者可管理', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const policy = new CustomViewPolicy(makePolicy())

    const ownerUser = { user: { id: 1, isSuperAdmin: false } } as any
    const otherUser = { user: { id: 2, isSuperAdmin: false } } as any
    const myView = {
      ownerUserId: 1,
      visibility: 'personal',
      organizationId: 1,
      projectId: 1,
    } as any

    assert.isTrue(await policy.manage(ownerUser, myView))
    assert.isFalse(await policy.manage(otherUser, myView))
    await policy.authorizeManage(ownerUser, myView)
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    await assert.rejects(
      () => policy.authorizeManage(otherUser, myView),
      PermissionDeniedException as any,
    )
  })

  test('manage shared：创建者/项目经理/组织管理员可管理', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const rbac = {
      async check() {
        return { allowed: true }
      },
    } as any
    const policy = new CustomViewPolicy(rbac)

    const creatorUser = { user: { id: 1, isSuperAdmin: false } } as any
    const managerUser = { user: { id: 2, isSuperAdmin: false } } as any
    const sharedView = {
      ownerUserId: 1,
      visibility: 'shared',
      organizationId: 1,
      projectId: 1,
    } as any

    // 创建者通过
    assert.isTrue(await policy.manage(creatorUser, sharedView))
    // 项目经理/组织管理员也通过（有 TASK_VIEW 且通过 RbacService）
    assert.isTrue(await policy.manage(managerUser, sharedView))
    await policy.authorizeManage(creatorUser, sharedView)
    await policy.authorizeManage(managerUser, sharedView)
  })

  test('manage shared：非管理员成员被拒绝', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const rbac = {
      async check() {
        return { allowed: false }
      },
    } as any
    const policy = new CustomViewPolicy(rbac)

    const nonOwner = { user: { id: 3, isSuperAdmin: false } } as any
    const sharedView = {
      ownerUserId: 1,
      visibility: 'shared',
      organizationId: 1,
      projectId: 1,
    } as any

    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    assert.isFalse(await policy.manage(nonOwner, sharedView))
    await assert.rejects(
      () => policy.authorizeManage(nonOwner, sharedView),
      PermissionDeniedException as any,
    )
  })

  test('manage shared：super admin 早退 true', async ({ assert }) => {
    const { default: CustomViewPolicy } = await import('#policies/custom_view_policy')
    const policy = new CustomViewPolicy(makePolicy())

    const admin = { user: { id: 99, isSuperAdmin: true } } as any
    const sharedView = {
      ownerUserId: 1,
      visibility: 'shared',
      organizationId: 1,
      projectId: 1,
    } as any

    assert.isTrue(await policy.manage(admin, sharedView))
    await policy.authorizeManage(admin, sharedView)
  })
})
