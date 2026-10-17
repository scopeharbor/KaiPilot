import RbacService from '#services/rbac_service'
import TokenService from '#services/token_service'
import {
  AI_TRIGGER,
  CanonicalRole,
  ORG_MANAGE,
  PROJECT_CREATE,
  PROJECT_VIEW,
  ProjectRoleName,
  ROLE_PERMISSIONS,
  TASK_CREATE,
  TASK_UPDATE,
  TASK_ASSIGN,
  WEBHOOK_MANAGE,
} from '#rbac'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import type { PermissionCheckResult } from '#types/auth'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/** 展平判定结果的 allowed 布尔（规避直接从 await 表达式取成员的 lint 规则）。 */
async function allowed(promise: Promise<PermissionCheckResult>): Promise<boolean> {
  const result = await promise
  return result.allowed
}

/**
 * 任务 6.6 — 授权/越权测试（权限相关覆盖 ≥95%）：
 * 系统管理员放行、最小权限取交集、默认拒绝、跨组织隔离、
 * 前端权限声明不被信任、bumpRoleVersion 后旧 token 即时失效。
 */
test.group('RBAC 授权判定', (group) => {
  useAuthDatabase(group)

  async function rbac() {
    return app.container.make(RbacService)
  }

  test('系统管理员对任意权限放行', async ({ assert }) => {
    const svc = await rbac()
    const admin = await createUser({ isSuperAdmin: true })
    const org = await createOrganization(await createUser())
    const res = await svc.check(admin, ORG_MANAGE, org.id)
    assert.isTrue(res.allowed)
    assert.equal(res.reason, 'system_admin')
  })

  test('组织管理员具备 project:create（组织级）', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const admin = await createUser()
    await addOrgMember(org, admin, 'admin')

    assert.isTrue(await allowed(svc.check(admin, PROJECT_CREATE, org.id)))
  })

  test('默认拒绝：无任何成员关系的用户被拒', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const outsider = await createUser()

    assert.isFalse(await allowed(svc.check(outsider, PROJECT_VIEW, org.id)))
  })

  test('跨组织隔离：A 组织成员在 B 组织无权限', async ({ assert }) => {
    const svc = await rbac()
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    const memberA = await createUser()
    await addOrgMember(orgA, memberA, 'member')

    assert.isTrue(await allowed(svc.check(memberA, PROJECT_VIEW, orgA.id)))
    assert.isFalse(await allowed(svc.check(memberA, PROJECT_VIEW, orgB.id)), '跨组织应无权限')
  })

  test('最小权限取交集：组织成员 ∩ 项目只读', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const user = await createUser()
    await addOrgMember(org, user, 'member')

    const { project } = await createProjectWithMember(
      org,
      owner,
      user,
      ProjectRoleName.READONLY_OBSERVER,
      [...ROLE_PERMISSIONS[CanonicalRole.READONLY_OBSERVER]],
    )

    // project:view 组织成员与项目只读都有 → 允许
    assert.isTrue(await allowed(svc.check(user, PROJECT_VIEW, org.id, project.id)))
    // task:create 组织成员有、项目只读没有 → 交集剔除 → 拒绝
    assert.isFalse(await allowed(svc.check(user, TASK_CREATE, org.id, project.id)))
    // ai:trigger 组织成员有、项目只读没有 → 拒绝
    assert.isFalse(await allowed(svc.check(user, AI_TRIGGER, org.id, project.id)))
  })

  test('项目角色下放：组织成员被设为项目经理时，本项目内可编辑/指派任务', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const pm = await createUser()
    await addOrgMember(org, pm, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      pm,
      ProjectRoleName.PROJECT_MANAGER,
      [...ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]],
    )

    assert.isTrue(await allowed(svc.check(pm, TASK_UPDATE, org.id, project.id)))
    assert.isTrue(await allowed(svc.check(pm, TASK_ASSIGN, org.id, project.id)))
    // 组织级敏感能力不随项目角色下放
    assert.isFalse(await allowed(svc.check(pm, WEBHOOK_MANAGE, org.id, project.id)))
    // 项目 scope 之外仍是普通成员
    assert.isFalse(await allowed(svc.check(pm, TASK_UPDATE, org.id)))

    const perms = await svc.resolveUserPermissions(pm, org.id, project.id)
    assert.include(perms, TASK_UPDATE)
    assert.notInclude(perms, WEBHOOK_MANAGE)
  })

  test('项目角色下放不适用组织只读：只读成员即使是项目经理也保持交集', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const { project } = await createProjectWithMember(
      org,
      owner,
      viewer,
      ProjectRoleName.PROJECT_MANAGER,
      [...ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]],
    )

    assert.isTrue(await allowed(svc.check(viewer, PROJECT_VIEW, org.id, project.id)))
    assert.isFalse(await allowed(svc.check(viewer, TASK_UPDATE, org.id, project.id)))
  })

  test('项目创建者默认拥有项目经理权限', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, ProjectRoleName.OWNER, [])
    // owner 是 org owner（org_admin）且是项目创建者 → 交集含 task:create
    assert.isTrue(await allowed(svc.check(owner, TASK_CREATE, org.id, project.id)))
  })

  test('resolveUserPermissions 返回组织∩项目交集，供 JWT claims', async ({ assert }) => {
    const svc = await rbac()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const user = await createUser()
    await addOrgMember(org, user, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      user,
      ProjectRoleName.READONLY_OBSERVER,
      [...ROLE_PERMISSIONS[CanonicalRole.READONLY_OBSERVER]],
    )

    const perms = await svc.resolveUserPermissions(user, org.id, project.id)
    assert.include(perms, PROJECT_VIEW)
    assert.notInclude(perms, TASK_CREATE, '交集应剔除项目只读不具备的写权限')
  })

  test('前端权限声明不被信任：伪造 permissions claim 不影响服务端判定', async ({ assert }) => {
    const svc = await rbac()
    const tokenSvc = await app.container.make(TokenService)
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')

    // 即便签发一个声称拥有 org:manage 的 token，服务端仍按 DB 角色判定（viewer 无 org:manage）
    const forged = await tokenSvc.generateAccessToken({
      sub: viewer.id,
      organizationId: org.id,
      roleVersion: viewer.roleVersion,
      permissions: [ORG_MANAGE],
    })
    const payload = await tokenSvc.verifyAccessToken(forged)
    assert.include(payload.permissions, ORG_MANAGE, 'token 内确实带有伪造声明')

    // 但服务端判定忽略声明，按 DB 角色（viewer→readonly_observer）→ 拒绝
    assert.isFalse(await allowed(svc.check(viewer, ORG_MANAGE, org.id)))
  })

  test('bumpRoleVersion 后旧 access token 即时失效（D9）', async ({ client }) => {
    const email = uniqueEmail('bump')
    const user = await createUser({ email })
    const login = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
    const oldAccess = login.body().data.accessToken

    // 旧 token 起初可访问 profile
    const before = await client
      .get('/api/v1/account/profile')
      .header('Authorization', `Bearer ${oldAccess}`)
    before.assertStatus(200)

    // 角色变更 → 递增 role_version
    const { default: AuthService } = await import('#services/auth_service')
    const auth = await app.container.make(AuthService)
    await auth.bumpRoleVersion(user.id)

    // 旧 token（roleVersion 过期）应被拒
    const after = await client
      .get('/api/v1/account/profile')
      .header('Authorization', `Bearer ${oldAccess}`)
    after.assertStatus(401)
    after.assertBodyContains({ error: { code: 'ROLE_VERSION_MISMATCH' } })
  })
})
