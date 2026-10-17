import AuditLog from '#models/audit_log'
import User from '#models/user'
import UserService from '#services/user_service'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('用户管理', (group) => {
  useAuthDatabase(group)

  test('UserService 创建、禁用即时失效并写审计', async ({ assert }) => {
    const admin = await createUser({ isSuperAdmin: true })
    const service = await app.container.make(UserService)
    const user = await service.create(
      {
        email: uniqueEmail('managed'),
        password: STRONG_PASSWORD,
        fullName: '受管用户',
      },
      admin.id,
    )
    await service.update(user.id, { isActive: false }, admin.id)

    const reloaded = await User.query().where('id', user.id).firstOrFail()
    assert.isFalse(reloaded.isActive)
    assert.equal(reloaded.roleVersion, 1)
    const auditRows = await AuditLog.query()
      .where('entity_type', 'user')
      .where('entity_id', user.id)
      .orderBy('id')
    assert.deepEqual(
      auditRows.map((row) => (row.metadata as { event: string }).event),
      ['USER_CREATED', 'USER_DISABLED'],
    )
    assert.isTrue(auditRows.every((row) => row.severity === 'info'))
  })

  test('UserService 阻止软删除仍拥有组织的 owner', async ({ assert }) => {
    const admin = await createUser({ isSuperAdmin: true })
    const owner = await createUser()
    await createOrganization(owner)
    const service = await app.container.make(UserService)

    await assert.rejects(() => service.softDelete(owner.id, admin.id), /请先转交组织所有权/)
  })

  test('系统管理员可完成用户 CRUD，响应不含密码', async ({ client, assert }) => {
    const admin = await createUser({ isSuperAdmin: true, email: uniqueEmail('sysadmin') })
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken
    const email = uniqueEmail('api-user')

    const created = await client
      .post('/api/v1/users')
      .header('Authorization', `Bearer ${token}`)
      .json({ email, password: STRONG_PASSWORD, fullName: 'API 用户' })
    created.assertStatus(201)
    assert.notProperty(created.body().data, 'password')

    const id = (created.body().data as { id: number }).id
    const listed = await client
      .get('/api/v1/users?search=api-user&is_active=true')
      .header('Authorization', `Bearer ${token}`)
    listed.assertStatus(200)
    assert.equal(listed.body().meta.total, 1)

    const updated = await client
      .put(`/api/v1/users/${id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ isActive: false })
    updated.assertStatus(200)
    assert.isFalse((updated.body().data as { isActive: boolean }).isActive)

    const removed = await client
      .delete(`/api/v1/users/${id}`)
      .header('Authorization', `Bearer ${token}`)
    removed.assertStatus(204)
    assert.isNull(await User.find(id))
  })

  test('非系统管理员访问用户管理端点统一 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    await createOrganization(owner)
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })

    const response = await client
      .get('/api/v1/users')
      .header('Authorization', `Bearer ${login.body().data.accessToken}`)
    response.assertStatus(403)
    response.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })
})
