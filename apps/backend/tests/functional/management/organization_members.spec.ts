import AuditLog from '#models/audit_log'
import OrganizationMember from '#models/organization_member'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('组织成员管理', (group) => {
  useAuthDatabase(group)

  test('邀请已注册用户成功；未注册 422；重复成员返回 2006', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const invited = await createUser({ email: uniqueEmail('invited') })
    const organization = await createOrganization(owner)
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const created = await client
      .post(`/api/v1/organizations/${organization.id}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: invited.email, role: 'member' })
    created.assertStatus(201)
    assert.equal(created.body().data.invitedBy, owner.id)
    assert.notProperty(created.body().data.user, 'password')

    const missing = await client
      .post(`/api/v1/organizations/${organization.id}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: uniqueEmail('missing') })
    missing.assertStatus(422)
    missing.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const duplicate = await client
      .post(`/api/v1/organizations/${organization.id}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: invited.email })
    duplicate.assertStatus(409)
    duplicate.assertBodyContains({ error: { code: '2006' } })
  })

  test('角色变更递增 role_version，旧 access token 下一请求失效', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const admin = await createUser({ email: uniqueEmail('admin') })
    const organization = await createOrganization(owner)
    const membership = await addOrgMember(organization, admin, 'admin')

    const adminLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const oldToken = adminLogin.body().data.accessToken
    const ownerLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })

    const changed = await client
      .put(`/api/v1/organizations/${organization.id}/members/${membership.id}`)
      .header('Authorization', `Bearer ${ownerLogin.body().data.accessToken}`)
      .json({ role: 'viewer' })
    changed.assertStatus(200)

    const stale = await client
      .get(`/api/v1/organizations/${organization.id}/members`)
      .header('Authorization', `Bearer ${oldToken}`)
    stale.assertStatus(401)
    await admin.refresh()
    assert.equal(admin.roleVersion, 1)
  })

  test('owner 降级与移除均被保护；转交 owner 后可处理原 owner', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const successor = await createUser({ email: uniqueEmail('successor') })
    const organization = await createOrganization(owner)
    const ownerMembership = await OrganizationMember.query()
      .where('organization_id', organization.id)
      .where('user_id', owner.id)
      .firstOrFail()
    const successorMembership = await addOrgMember(organization, successor, 'admin')
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const downgrade = await client
      .put(`/api/v1/organizations/${organization.id}/members/${ownerMembership.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ role: 'admin' })
    downgrade.assertStatus(409)

    const remove = await client
      .delete(`/api/v1/organizations/${organization.id}/members/${ownerMembership.id}`)
      .header('Authorization', `Bearer ${token}`)
    remove.assertStatus(409)

    const transfer = await client
      .put(`/api/v1/organizations/${organization.id}/members/${successorMembership.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ role: 'owner' })
    transfer.assertStatus(200)
  })

  test('普通成员执行邀请被拒 403，成员动作均写审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const member = await createUser({ email: uniqueEmail('member') })
    const target = await createUser({ email: uniqueEmail('target') })
    const organization = await createOrganization(owner)
    await addOrgMember(organization, member, 'member')
    const memberLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: member.email, password: STRONG_PASSWORD })

    const denied = await client
      .post(`/api/v1/organizations/${organization.id}/members/invite`)
      .header('Authorization', `Bearer ${memberLogin.body().data.accessToken}`)
      .json({ email: target.email })
    denied.assertStatus(403)

    const ownerLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const invited = await client
      .post(`/api/v1/organizations/${organization.id}/members/invite`)
      .header('Authorization', `Bearer ${ownerLogin.body().data.accessToken}`)
      .json({ email: target.email })
    const memberId = invited.body().data.id
    const targetLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: target.email, password: STRONG_PASSWORD })
    const removed = await client
      .delete(`/api/v1/organizations/${organization.id}/members/${memberId}`)
      .header('Authorization', `Bearer ${ownerLogin.body().data.accessToken}`)
    removed.assertStatus(204)

    const stale = await client
      .get(`/api/v1/organizations/${organization.id}`)
      .header('Authorization', `Bearer ${targetLogin.body().data.accessToken}`)
    stale.assertStatus(404)

    const auditRows = await AuditLog.query().where('organization_id', organization.id).orderBy('id')
    const events = auditRows.map((row) => (row.metadata as { event?: string }).event)
    assert.includeMembers(events, ['MEMBER_INVITED', 'MEMBER_REMOVED'])
  })

  test('owner 经显式端点转交所有权成功；记专用审计；双方旧 token 失效', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const successor = await createUser({ email: uniqueEmail('successor') })
    const organization = await createOrganization(owner)
    const successorMembership = await addOrgMember(organization, successor, 'admin')
    const ownerLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const ownerToken = ownerLogin.body().data.accessToken

    const transfer = await client
      .post(`/api/v1/organizations/${organization.id}/transfer-owner`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ memberId: successorMembership.id })
    transfer.assertStatus(200)
    assert.equal(transfer.body().data.previousOwnerId, owner.id)
    assert.equal(transfer.body().data.newOwnerId, successor.id)

    const auditRow = await AuditLog.query()
      .where('organization_id', organization.id)
      .where('entity_type', 'organization')
      .orderBy('id', 'desc')
      .first()
    assert.equal((auditRow?.metadata as { event?: string }).event, 'ORG_OWNER_TRANSFERRED')

    // 双方 role_version 递增，原 owner 旧 token 下一请求失效
    const staleOwner = await client
      .get(`/api/v1/organizations/${organization.id}`)
      .header('Authorization', `Bearer ${ownerToken}`)
    staleOwner.assertStatus(401)
  })

  test('非 owner 转交被拒 403；转交非成员 404；目标已 owner 409', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner2') })
    const admin = await createUser({ email: uniqueEmail('admin2') })
    const organization = await createOrganization(owner)
    await addOrgMember(organization, admin, 'admin')
    const ownerLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const ownerToken = ownerLogin.body().data.accessToken
    const adminLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const adminToken = adminLogin.body().data.accessToken
    const ownerMembership = await OrganizationMember.query()
      .where('organization_id', organization.id)
      .where('user_id', owner.id)
      .firstOrFail()

    // 非 owner（admin）转交被拒 403
    const adminAttempt = await client
      .post(`/api/v1/organizations/${organization.id}/transfer-owner`)
      .header('Authorization', `Bearer ${adminToken}`)
      .json({ memberId: ownerMembership.id })
    adminAttempt.assertStatus(403)

    // 转交不存在的成员 → 404（memberOrFail + TenantScope）
    const missingRes = await client
      .post(`/api/v1/organizations/${organization.id}/transfer-owner`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ memberId: 999999 })
    missingRes.assertStatus(404)

    // 目标已是 owner（owner 转给自己）→ 409
    const selfTransfer = await client
      .post(`/api/v1/organizations/${organization.id}/transfer-owner`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ memberId: ownerMembership.id })
    selfTransfer.assertStatus(409)
  })
})
