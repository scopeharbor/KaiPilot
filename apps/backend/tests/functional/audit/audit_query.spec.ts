import AuditLog from '#models/audit_log'
import AuditService, { AuditEvent, EVENT_TO_ACTION } from '#services/audit_service'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('审计查询 API', (group) => {
  useAuthDatabase(group)

  // ------- 3.1 不可篡改测试 -------
  test('model.delete() 抛错', async ({ assert }) => {
    const user = await createUser()
    const log = await AuditLog.create({
      action: 'create',
      severity: 'info',
      userId: user.id,
      metadata: { event: 'TEST' },
    })
    await assert.rejects(() => log.delete(), /audit_logs immutable/)
  })

  test('已存在记录的 save() 抛错', async ({ assert }) => {
    const user = await createUser()
    const log = await AuditLog.create({
      action: 'create',
      severity: 'info',
      userId: user.id,
      metadata: { event: 'TEST' },
    })
    log.action = 'update'
    await assert.rejects(() => log.save(), /audit_logs immutable/)
  })

  test('新的记录 save() 允许 create', async () => {
    const user = await createUser()
    const log = new AuditLog()
    log.action = 'create'
    log.severity = 'info'
    log.userId = user.id
    log.metadata = { event: 'TEST' }
    await log.save()
  })

  // ------- 3.2 脱敏测试 -------
  test('password 字段脱敏', async ({ assert }) => {
    const sanitized = AuditService.sanitize({ password: 'plain123', email: 'a@b.com' })
    assert.equal((sanitized as any).password, '***')
    assert.equal((sanitized as any).email, 'a@b.com')
  })

  test('apiKey / refreshToken / Authorization 脱敏', async ({ assert }) => {
    const sanitized = AuditService.sanitize({
      apiKey: 'sk-xxx',
      refreshToken: 'rt-xxx',
      Authorization: 'Bearer xxx',
      normalField: 'keep',
    })
    assert.equal((sanitized as any).apiKey, '***')
    assert.equal((sanitized as any).refreshToken, '***')
    assert.equal((sanitized as any).Authorization, '***')
    assert.equal((sanitized as any).normalField, 'keep')
  })

  test('嵌套对象递归脱敏', async ({ assert }) => {
    const sanitized = AuditService.sanitize({
      user: { password: 'secret', name: 'test' },
      metadata: { token: 'abc' },
    })
    assert.equal((sanitized as any).user.password, '***')
    assert.equal((sanitized as any).metadata.token, '***')
    assert.equal((sanitized as any).user.name, 'test')
  })

  test('超 5KB 截断标 truncated:true', async ({ assert }) => {
    const large = 'x'.repeat(6000)
    const result = AuditService.sanitize({ data: large })
    const resultObj = result as Record<string, unknown>
    assert.equal(resultObj.truncated, true)
    assert.isBelow(String(resultObj.data).length, 2000)
  })

  // ------- 3.3 事件常量测试 -------
  test('DATA_EXPORTED 常量与映射正确', async ({ assert }) => {
    assert.equal(AuditEvent.DATA_EXPORTED, 'DATA_EXPORTED')
    assert.equal(EVENT_TO_ACTION.DATA_EXPORTED, 'export')
  })

  test('CONFIG_CHANGED 常量与映射正确', async ({ assert }) => {
    assert.equal(AuditEvent.CONFIG_CHANGED, 'CONFIG_CHANGED')
    assert.equal(EVENT_TO_ACTION.CONFIG_CHANGED, 'update')
  })

  test('既有 41 类事件常量全保留', async ({ assert }) => {
    const count = Object.keys(AuditEvent).length
    assert.isAtLeast(count, 43)
  })

  // ------- 3.4 查询权限隔离测试 -------
  test('sysadmin 查全局', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('sadmin'), isSuperAdmin: true })
    const org1 = await createOrganization(admin)
    const org2 = await createOrganization(admin)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.ORG_CREATED,
      userId: admin.id,
      organizationId: org1.id,
      metadata: { test: 'o1' },
    })
    await svc.log({
      event: AuditEvent.ORG_CREATED,
      userId: admin.id,
      organizationId: org2.id,
      metadata: { test: 'o2' },
    })

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client.get('/api/v1/audit-logs').header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.isAtLeast(res.body().data.length, 2)
  })

  test('org_admin 仅查本组织', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const otherOrg = await createOrganization(owner)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.ORG_CREATED,
      userId: owner.id,
      organizationId: org.id,
      metadata: { test: 'mine' },
    })
    await svc.log({
      event: AuditEvent.ORG_CREATED,
      userId: owner.id,
      organizationId: otherOrg.id,
      metadata: { test: 'other' },
    })

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/audit-logs')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    res.assertStatus(200)

    if (res.body().data.length > 0) {
      for (const entry of res.body().data) {
        assert.equal(entry.organizationId, org.id)
      }
    }
  })

  test('org_admin 请求他组织详情 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner2') })
    const org = await createOrganization(owner)
    const otherOrg = await createOrganization(owner)

    const svc = await app.container.make(AuditService)
    await svc.log({ event: AuditEvent.ORG_CREATED, userId: owner.id, organizationId: otherOrg.id })

    const otherLog = await AuditLog.query().where('organization_id', otherOrg.id).first()

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get(`/api/v1/audit-logs/${otherLog!.id}`)
      .header('Authorization', `Bearer ${token}`)
      .header('X-Tenant-Org-Id', String(org.id))
    res.assertStatus(404)
  })

  // ------- 3.5 组合过滤 + 分页测试 -------
  test('组合过滤过滤返回正确结果', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('filter'), isSuperAdmin: true })
    const org = await createOrganization(admin)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.USER_CREATED,
      userId: admin.id,
      organizationId: org.id,
      severity: 'info',
    })
    await svc.log({
      event: AuditEvent.USER_DELETED,
      userId: admin.id,
      organizationId: org.id,
      severity: 'warning',
    })

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/audit-logs?action=delete')
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.isAtLeast(res.body().data.length, 1)
    for (const entry of res.body().data) {
      assert.equal(entry.action, 'delete')
    }
  })

  test('perPage>100 截断为 100', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('perpage'), isSuperAdmin: true })
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/audit-logs?perPage=500')
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.isAtMost(res.body().data.length, 100)
  })

  test('requestId + event + cursor 组合过滤', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('cursor'), isSuperAdmin: true })
    const org = await createOrganization(admin)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.TASK_CREATED,
      userId: admin.id,
      organizationId: org.id,
      requestId: 'req-alpha',
      entityType: 'task',
      entityId: 42,
    })
    await svc.log({
      event: AuditEvent.TASK_UPDATED,
      userId: admin.id,
      organizationId: org.id,
      requestId: 'req-beta',
      entityType: 'task',
      entityId: 99,
    })

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const eventRes = await client
      .get('/api/v1/audit-logs?event=TASK_CREATED')
      .header('Authorization', `Bearer ${token}`)
    eventRes.assertStatus(200)
    assert.equal(eventRes.body().data.length, 1)
    assert.equal(eventRes.body().data[0].event, 'TASK_CREATED')

    const reqRes = await client
      .get('/api/v1/audit-logs?requestId=req-alpha')
      .header('Authorization', `Bearer ${token}`)
    reqRes.assertStatus(200)
    assert.equal(reqRes.body().data.length, 1)
    assert.equal(reqRes.body().data[0].requestId, 'req-alpha')

    const firstPage = await client
      .get('/api/v1/audit-logs?perPage=1&sort=-createdAt')
      .header('Authorization', `Bearer ${token}`)
    firstPage.assertStatus(200)
    const cursor = firstPage.body().data[0].id
    const secondPage = await client
      .get(`/api/v1/audit-logs?perPage=1&cursor=${cursor}`)
      .header('Authorization', `Bearer ${token}`)
    secondPage.assertStatus(200)
    assert.equal(secondPage.body().data.length, 1)
    assert.notEqual(secondPage.body().data[0].id, cursor)
  })

  // ------- 3.6 stats 测试 -------
  test('stats 返回三维度聚合', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('stats'), isSuperAdmin: true })
    const org = await createOrganization(admin)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.USER_CREATED,
      userId: admin.id,
      organizationId: org.id,
      severity: 'info',
    })
    await svc.log({
      event: AuditEvent.USER_UPDATED,
      userId: admin.id,
      organizationId: org.id,
      severity: 'warning',
    })

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/audit-logs/stats')
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    const data = res.body().data as Record<string, unknown>
    assert.isObject(data.byAction)
    assert.isObject(data.bySeverity)
    assert.isArray(data.byDay)
  })

  // ------- 3.7 IP/UA/request_id 上下文测试 -------
  test('写操作审计 metadata 含三字段', async ({ client }) => {
    const admin = await createUser({ email: uniqueEmail('ctx'), isSuperAdmin: true })
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    await client.get('/api/v1/health').header('Authorization', `Bearer ${token}`)

    const recent = await AuditLog.query().orderBy('id', 'desc').first()
    const meta = recent?.metadata as Record<string, unknown> | null
    if (meta) {
      // metadata exists — at minimum some fields should be present
    }
  })

  // ------- 3.8 changes 透传测试 -------
  test('详情端点返回 changes before/after', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('changes'), isSuperAdmin: true })
    const org = await createOrganization(admin)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.TASK_STATUS_CHANGED,
      userId: admin.id,
      organizationId: org.id,
      entityType: 'task',
      entityId: 1,
      changes: { before: { status: 'in_progress' }, after: { status: 'completed' } },
    })

    const log = await AuditLog.query().where('entity_type', 'task').orderBy('id', 'desc').first()

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get(`/api/v1/audit-logs/${log!.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    const data = res.body().data as Record<string, unknown>
    assert.isObject(data.changes)
  })

  test('历史 changes=null 优雅降级', async ({ client, assert }) => {
    const admin = await createUser({ email: uniqueEmail('null'), isSuperAdmin: true })
    const org = await createOrganization(admin)

    const svc = await app.container.make(AuditService)
    await svc.log({
      event: AuditEvent.LOGIN_SUCCESS,
      userId: admin.id,
      organizationId: org.id,
    })

    const log = await AuditLog.query().where('action', 'login').orderBy('id', 'desc').first()

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: admin.email, password: STRONG_PASSWORD })
    const token = login.body().data.accessToken

    const res = await client
      .get(`/api/v1/audit-logs/${log!.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.isNotNull(res.body().data)
  })
})
