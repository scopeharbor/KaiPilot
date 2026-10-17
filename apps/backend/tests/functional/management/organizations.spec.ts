import AuditLog from '#models/audit_log'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import User from '#models/user'
import AuthService from '#services/auth_service'
import OrganizationService from '#services/organization_service'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('组织管理', (group) => {
  useAuthDatabase(group)

  test('注册在事务内创建默认组织并返回 organizations', async ({ client, assert }) => {
    const email = uniqueEmail('register-org')
    const response = await client.post('/api/v1/auth/register').json({
      fullName: '新用户',
      organizationName: '新团队',
      email,
      password: STRONG_PASSWORD,
      passwordConfirmation: STRONG_PASSWORD,
    })
    response.assertStatus(201)
    assert.equal(response.body().data.user.organizations.length, 1)
    assert.equal(response.body().data.user.organizations[0].role, 'owner')

    const user = await User.findByOrFail('email', email)
    const organization = await Organization.findByOrFail('owner_id', user.id)
    assert.equal(organization.name, '新团队')
    assert.exists(
      await OrganizationMember.query()
        .where('organization_id', organization.id)
        .where('user_id', user.id)
        .where('role', 'owner')
        .first(),
    )
  })

  test('组织创建步骤失败时注册事务回滚，不残留孤儿用户', async ({ assert }) => {
    const original = OrganizationService.prototype.generateUniqueSlug
    OrganizationService.prototype.generateUniqueSlug = async () => {
      throw new Error('slug generation failed')
    }
    const email = uniqueEmail('rollback')

    try {
      const service = await app.container.make(AuthService)
      await assert.rejects(() =>
        service.register({ fullName: '回滚用户', email, password: STRONG_PASSWORD }),
      )
      assert.isNull(await User.findBy('email', email))
    } finally {
      OrganizationService.prototype.generateUniqueSlug = original
    }
  })

  test('我的组织仅返回成员关系中的组织，跨组织详情返回 404', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('owner-a') })
    const ownerB = await createUser({ email: uniqueEmail('owner-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: ownerA.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const list = await client
      .get('/api/v1/organizations')
      .header('Authorization', `Bearer ${token}`)
    list.assertStatus(200)
    assert.deepEqual(
      (list.body().data as Array<{ id: number }>).map((item) => item.id),
      [orgA.id],
    )

    const cross = await client
      .get(`/api/v1/organizations/${orgB.id}`)
      .header('Authorization', `Bearer ${token}`)
    cross.assertStatus(404)
    cross.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('owner/admin 可编辑组织，member 被拒 403', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const member = await createUser({ email: uniqueEmail('member') })
    const organization = await createOrganization(owner)
    await addOrgMember(organization, member, 'member')

    const ownerLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const updated = await client
      .put(`/api/v1/organizations/${organization.id}`)
      .header('Authorization', `Bearer ${ownerLogin.body().data.accessToken}`)
      .json({ name: '更新后的组织', description: '组织简介' })
    updated.assertStatus(200)
    assert.equal(updated.body().data.description, '组织简介')

    const memberLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: member.email, password: STRONG_PASSWORD })
    const denied = await client
      .put(`/api/v1/organizations/${organization.id}`)
      .header('Authorization', `Bearer ${memberLogin.body().data.accessToken}`)
      .json({ name: '越权修改' })
    denied.assertStatus(403)
  })

  test('仅系统管理员可创建和软删除组织', async ({ client, assert }) => {
    const systemAdmin = await createUser({
      isSuperAdmin: true,
      email: uniqueEmail('system-admin'),
    })
    const owner = await createUser({ email: uniqueEmail('new-owner') })
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: systemAdmin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const created = await client
      .post('/api/v1/organizations')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '管理员创建', ownerId: owner.id })
    created.assertStatus(201)
    const organizationId = (created.body().data as { id: number }).id

    const removed = await client
      .delete(`/api/v1/organizations/${organizationId}`)
      .header('Authorization', `Bearer ${token}`)
    removed.assertStatus(204)
    assert.isNull(await Organization.find(organizationId))

    const auditRows = await AuditLog.query().where('organization_id', organizationId).orderBy('id')
    assert.deepEqual(
      auditRows.map((row) => (row.metadata as { event: string }).event),
      ['ORG_CREATED', 'ORG_DELETED'],
    )
    assert.isTrue(auditRows.every((row) => row.severity === 'info'))
  })
})
