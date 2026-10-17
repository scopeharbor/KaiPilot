import AuthService from '#services/auth_service'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import User from '#models/user'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'

/** Lucid count() 行形态（避免 Organization 模型类型误用）。 */
async function countOrganizations(): Promise<number> {
  const rows = (await Organization.query().count('* as total')) as unknown as Array<{
    total: string | number
  }>
  return Number(rows[0]?.total ?? 0)
}

/**
 * v3-docker-google-oauth-runtime-wiring —— tasks 1.3
 * 邀请优先的 Google 登录成员解析（design C）：
 *   DGO-05 受邀 member 不会成为 owner / 平台管理员
 *   DGO-06 个人自助注册仍得到隔离免费组织
 *   DGO-07 同 email 既有账户不重复建号；identity-first 防邮箱变更重复建号
 */
test.group('Google 登录邀请/成员优先（tasks 1.3）', (group) => {
  useAuthDatabase(group)

  async function service() {
    return app.container.make(AuthService)
  }

  test('DGO-05 受邀 member 用 Google 登录：复用既有账号、邀请角色不变、非 owner、无新组织', async ({
    assert,
  }) => {
    const svc = await service()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const email = uniqueEmail('invited-google')
    const invited = await createUser({ email })
    // 本数据模型中邀请物化为 organization_members 行（invited_by 记录邀请人）；
    // 受邀角色在 invite() 时已写入，登录只应保持、绝不追加 owner。
    const membership = await OrganizationMember.create({
      organizationId: org.id,
      userId: invited.id,
      role: 'member',
      invitedBy: owner.id,
    })
    const orgCountBefore = await countOrganizations()

    const { user } = await svc.loginWithGoogle({
      sub: `google-sub-invited-${invited.id}`,
      email,
      email_verified: true,
      name: '受邀成员',
    })

    assert.equal(Number(user.id), Number(invited.id), '复用既有账号，不重复建号')
    assert.equal(user.authProvider, 'local', '既有密码账号身份不被覆盖')
    assert.isFalse(user.isSuperAdmin, 'Google provider 不授予平台管理员')
    const after = await OrganizationMember.query().where('id', membership.id).firstOrFail()
    assert.equal(after.role, 'member', '邀请角色保持不变')
    assert.equal(Number(after.invitedBy), Number(owner.id), '邀请链路保留')
    assert.equal(Number(org.ownerId), Number(owner.id), '受邀 member 未成为组织 owner')
    const orgCountAfter = await countOrganizations()
    assert.equal(orgCountAfter, orgCountBefore, '未为受邀用户创建任何新组织')
  })

  test('DGO-05b 既有 Google member（viewer）再次登录：角色保持、不升级', async ({ assert }) => {
    const svc = await service()
    const owner = await createUser()
    const org = await createOrganization(owner)
    const email = uniqueEmail('google-viewer')
    const { user } = await svc.loginWithGoogle({
      sub: 'google-sub-viewer',
      email,
      email_verified: true,
    })
    const membership = await OrganizationMember.create({
      organizationId: org.id,
      userId: user.id,
      role: 'viewer',
      invitedBy: owner.id,
    })

    const { user: again } = await svc.loginWithGoogle({
      sub: 'google-sub-viewer',
      email,
      email_verified: true,
    })
    assert.equal(Number(again.id), Number(user.id))
    const after = await OrganizationMember.query().where('id', membership.id).firstOrFail()
    assert.equal(after.role, 'viewer')
    assert.equal(Number(org.ownerId), Number(owner.id))
  })

  test('DGO-06 个人自助注册：隔离的免费组织、本人唯一 owner、零企业权益', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('self-signup-google')

    const { user, permissions } = await svc.loginWithGoogle({
      sub: 'google-sub-self',
      email,
      email_verified: true,
      name: '自助用户',
    })

    assert.equal(user.authProvider, 'google')
    assert.equal(user.providerId, 'google-sub-self')
    assert.equal(user.email, email)
    assert.isFalse(user.isSuperAdmin, '自助注册不授予平台管理员')
    assert.isString(permissions[0] ?? '', '签发正常会话权限')

    const org = await Organization.query().where('owner_id', user.id).firstOrFail()
    assert.equal(org.planTier, 'free', '个人工作区为 free 档')
    const owners = await OrganizationMember.query()
      .where('organization_id', org.id)
      .where('role', 'owner')
    assert.equal(owners.length, 1)
    assert.equal(Number(owners[0]!.userId), Number(user.id))
    const members = await OrganizationMember.query().where('organization_id', org.id)
    assert.equal(members.length, 1, '个人组织完全隔离：只有本人')
  })

  test('DGO-07a 同 email 已有密码账户：不重复建 user、身份不覆盖', async ({ assert }) => {
    const svc = await service()
    const email = uniqueEmail('same-email-local')
    const local = await createUser({ email })

    const { user } = await svc.loginWithGoogle({
      sub: 'google-sub-collision',
      email,
      email_verified: true,
    })

    assert.equal(Number(user.id), Number(local.id), '复用同一 user 行')
    assert.equal(user.authProvider, 'local')
    assert.isNull(user.providerId, '密码账户不被写入 google sub')
    const rows = await User.query().where('email', email)
    assert.equal(rows.length, 1, '全程只有 1 个 user 行')
  })

  test('DGO-07b identity-first：同 provider sub 邮箱变更不重复建号并同步 email', async ({
    assert,
  }) => {
    const svc = await service()
    const emailA = uniqueEmail('identity-a')
    const { user: first } = await svc.loginWithGoogle({
      sub: 'stable-google-sub',
      email: emailA,
      email_verified: true,
    })
    const emailB = uniqueEmail('identity-b')
    const { user: second } = await svc.loginWithGoogle({
      sub: 'stable-google-sub',
      email: emailB,
      email_verified: true,
    })

    assert.equal(Number(second.id), Number(first.id), '按 (google, sub) 命中同一身份')
    assert.equal(second.email, emailB, '邮箱变更已同步')
    const bySub = await User.query().where('provider_id', 'stable-google-sub')
    assert.equal(bySub.length, 1, '不因邮箱变更重复建号')
    const orgsForUser = await Organization.query().where('owner_id', second.id)
    assert.equal(orgsForUser.length, 1, '仍只有一个个人组织')
  })
})
