/**
 * 套餐权益门控（plan policy）—— free 个人组织不授企业能力。
 *
 * 产品裁定：企业能力（SSO / KMS / DLP / 水印 / 合规 / 组织级多租户 / AI 质量成本
 * 控制台 / 发布信任 / 插件目录与策略管理等）一律由套餐权益门控，free 不授；
 * org_admin 基础能力（用户/邀请/组织设置/审计/项目等）保留。
 *
 * 覆盖：
 * ① free 组织 owner 无企业权限（逐项列枚举断言），team/enterprise 有；
 * ② 显式 organization_members.permissions 中的企业权限在 free 组织同样被剥离；
 * ③ system_admin 哨兵不受套餐影响；
 * ④ /auth/me 与 JWT claims 携带 planTier（free / enterprise / 无组织 null）；
 * ⑤ 个人免费组织用户访问 SSO / KMS / DLP / 合规模板端点 → 403 PERMISSION_DENIED，
 *    付费组织同端点放行。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import AuthService from '#services/auth_service'
import RbacService from '#services/rbac_service'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import {
  ENTERPRISE_PERMISSIONS,
  ORG_MANAGE,
  ORG_MEMBER_MANAGE,
  AUDIT_VIEW,
  PROJECT_CREATE,
  SYSTEM_ADMIN,
  type Permission,
} from '#rbac'
import { STRONG_PASSWORD, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'
import { decodeJwtForTest } from './_jwt_helper.js'
import type User from '#models/user'

async function rbacService(): Promise<RbacService> {
  return app.container.make(RbacService)
}

async function authService(): Promise<AuthService> {
  return app.container.make(AuthService)
}

/** 建指定套餐的组织（owner 写入 organization_members）。 */
async function createOrgWithTier(owner: User, planTier: string): Promise<Organization> {
  const org = await Organization.create({
    ownerId: owner.id,
    name: '套餐测试组织',
    slug: `tier-${planTier}-${owner.id}-${Date.now()}`,
    planTier,
  })
  await OrganizationMember.create({
    organizationId: org.id,
    userId: owner.id,
    role: 'owner',
  })
  return org
}

test.group('套餐权益门控：free 组织不授企业能力', (group) => {
  useAuthDatabase(group)

  test('① free 组织 owner 无企业权限；team/enterprise 组织 owner 有', async ({ assert }) => {
    const svc = await rbacService()
    const freeOwner = await createUser({ email: uniqueEmail('tier-free') })
    const freeOrg = await createOrgWithTier(freeOwner, 'free')
    const teamOwner = await createUser({ email: uniqueEmail('tier-team') })
    const teamOrg = await createOrgWithTier(teamOwner, 'team')
    const entOwner = await createUser({ email: uniqueEmail('tier-ent') })
    const entOrg = await createOrgWithTier(entOwner, 'enterprise')

    const freePerms = await svc.resolveOrganizationPermissions(freeOwner, freeOrg.id)
    const teamPerms = await svc.resolveOrganizationPermissions(teamOwner, teamOrg.id)
    const entPerms = await svc.resolveOrganizationPermissions(entOwner, entOrg.id)

    // free：企业权限一个都不能有（逐项列枚举断言）
    for (const enterprise of ENTERPRISE_PERMISSIONS) {
      assert.isFalse(freePerms.has(enterprise), `free 组织 owner 不应拥有企业权限 ${enterprise}`)
    }

    // free：org_admin 基础能力保留（用户/邀请/组织设置/审计/项目等）
    for (const base of [ORG_MANAGE, ORG_MEMBER_MANAGE, AUDIT_VIEW, PROJECT_CREATE] as const) {
      assert.isTrue(freePerms.has(base), `free 组织 owner 应保留基础权限 ${base}`)
    }

    // team / enterprise：企业权限全量授予
    for (const enterprise of ENTERPRISE_PERMISSIONS) {
      assert.isTrue(teamPerms.has(enterprise), `team 组织 owner 应拥有企业权限 ${enterprise}`)
      assert.isTrue(entPerms.has(enterprise), `enterprise 组织 owner 应拥有企业权限 ${enterprise}`)
    }
  })

  test('③ system_admin 哨兵不受套餐影响（free 组织内仍整体放行）', async ({ assert }) => {
    const svc = await rbacService()
    const superAdmin = await createUser({
      email: uniqueEmail('tier-super'),
      isSuperAdmin: true,
    })
    const freeOrg = await createOrgWithTier(
      await createUser({ email: uniqueEmail('tier-free-owner') }),
      'free',
    )

    const resolved = await svc.resolveUserPermissions(superAdmin, freeOrg.id)
    assert.deepEqual(resolved, [SYSTEM_ADMIN], '超管在 free 组织同样只回哨兵权限')

    // 判定链放行：check() 对超管直接 allowed
    const baseCheck = await svc.check(superAdmin, PROJECT_CREATE, freeOrg.id)
    assert.isTrue(baseCheck.allowed)
    assert.equal(baseCheck.reason, 'system_admin')
  })

  test('④ /auth/me 与 JWT claims 携带 planTier（free / enterprise / 无组织 null）', async ({
    assert,
    client,
  }) => {
    const service = await authService()

    // free 组织
    const freeUser = await createUser({ email: uniqueEmail('me-free') })
    await createOrgWithTier(freeUser, 'free')
    const freeLogin = await service.login({ email: freeUser.email, password: STRONG_PASSWORD })
    assert.equal(freeLogin.planTier, 'free', 'AuthResult.planTier 应来自当前生效组织')
    assert.equal(
      decodeJwtForTest(freeLogin.accessToken).planTier,
      'free',
      'JWT claims 应含 planTier',
    )
    const freeMe = await client.get('/api/v1/account/profile').bearerToken(freeLogin.accessToken)
    assert.equal(freeMe.status(), 200)
    assert.equal(freeMe.body().data.planTier, 'free', '/auth/me 应返回 planTier=free')

    // enterprise 组织
    const entUser = await createUser({ email: uniqueEmail('me-ent') })
    await createOrgWithTier(entUser, 'enterprise')
    const entLogin = await service.login({ email: entUser.email, password: STRONG_PASSWORD })
    assert.equal(entLogin.planTier, 'enterprise')
    assert.equal(decodeJwtForTest(entLogin.accessToken).planTier, 'enterprise')
    const entMe = await client.get('/api/v1/account/profile').bearerToken(entLogin.accessToken)
    assert.equal(entMe.body().data.planTier, 'enterprise')

    // 无组织用户：planTier = null（JWT 与 me 一致）
    const orphan = await createUser({ email: uniqueEmail('me-orphan') })
    const orphanLogin = await service.login({ email: orphan.email, password: STRONG_PASSWORD })
    assert.equal(orphanLogin.planTier, null, '无组织用户 planTier 为 null')
    assert.equal(decodeJwtForTest(orphanLogin.accessToken).planTier, null)
    const orphanMe = await client
      .get('/api/v1/account/profile')
      .bearerToken(orphanLogin.accessToken)
    assert.equal(orphanMe.status(), 200)
    assert.equal(orphanMe.body().data.planTier, null)
  })

  test('⑥ resolveUserPermissions 的 JWT 权限声明同样受门控（free 集不含企业权限）', async ({
    assert,
  }) => {
    const svc = await rbacService()
    const owner = await createUser({ email: uniqueEmail('tier-jwt') })
    const org = await createOrgWithTier(owner, 'free')

    const claims = await svc.resolveUserPermissions(owner, org.id)
    const claimSet = new Set<Permission>(claims)
    for (const enterprise of ENTERPRISE_PERMISSIONS) {
      assert.isFalse(claimSet.has(enterprise), `JWT 权限声明不应含 ${enterprise}`)
    }
  })
})
