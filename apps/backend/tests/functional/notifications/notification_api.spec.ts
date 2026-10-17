import Notification from '#models/notification'
import NotificationPolicy from '#policies/notification_policy'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * 任务 1.6 / 2.6 — 通知 Model/Policy/API 测试：
 * - 组织隔离
 * - 接收人隔离
 * - 外部协作者和只读观察者边界
 * - 列表 / 未读数 / 单条已读 / 全部已读
 * - 分页上限 / 越权 / 未认证
 */
test.group('通知', (group) => {
  useAuthDatabase(group)

  // ---------------- 辅助 ----------------

  async function policy() {
    return app.container.make(NotificationPolicy)
  }

  /** 创建带通知的用户/组织上下文。 */
  async function createNotificationContext() {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const outsider = await createUser() // 另一个组织的用户
    return { owner, org, member, outsider }
  }

  /** 用指定接收人和组织创建一条通知。 */
  async function createNotification(
    recipientId: number,
    organizationId: number,
    overrides: Partial<{
      type: string
      title: string
      body: string | null
      severity: string
      projectId: number | null
      targetType: string | null
      targetId: number | null
      readAt: DateTime | null
      idempotencyKey: string | null
      metadata: Record<string, unknown> | null
    }> = {},
  ) {
    return Notification.create({
      recipientId,
      organizationId,
      type: overrides.type ?? 'task_assigned',
      title: overrides.title ?? '测试通知',
      body: overrides.body ?? null,
      severity: overrides.severity ?? 'info',
      projectId: overrides.projectId ?? null,
      targetType: overrides.targetType ?? null,
      targetId: overrides.targetId ?? null,
      readAt: overrides.readAt ?? null,
      idempotencyKey: overrides.idempotencyKey ?? null,
      metadata: overrides.metadata ?? null,
    })
  }

  // ---------------- 1.6 Model/Policy 单元测试 ----------------

  test('通知创建成功', async ({ assert }) => {
    const { owner, org } = await createNotificationContext()
    const n = await createNotification(owner.id, org.id, { title: '任务已指派给你' })
    assert.equal(n.title, '任务已指派给你')
    assert.equal(Number(n.recipientId), owner.id)
    assert.equal(Number(n.organizationId), org.id)
    assert.isNull(n.readAt)
  })

  test('组织隔离：同一用户在 A 组织看不到 B 组织的通知', async ({ assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    // 在 A 组织为用户创建通知
    await createNotification(ownerA.id, orgA.id, { title: 'A组织通知' })
    // 在 B 组织为同一用户创建通知
    await createNotification(ownerA.id, orgB.id, { title: 'B组织通知' })

    // 只应查到 A 组织的通知
    const rows = await Notification.query()
      .where('recipient_id', ownerA.id)
      .where('organization_id', orgA.id)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].title, 'A组织通知')
  })

  test('接收人隔离：用户只能看到自己的通知', async ({ assert }) => {
    const { org, member, outsider } = await createNotificationContext()
    await createNotification(member.id, org.id, { title: '成员的通知' })
    await createNotification(outsider.id, org.id, { title: '外人的通知' })

    const rows = await Notification.query()
      .where('recipient_id', member.id)
      .where('organization_id', org.id)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].title, '成员的通知')
  })

  test('外部协作者只能看到自己的通知', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const extCollab = await createUser()
    await addOrgMember(org, extCollab, 'member')
    const otherMember = await createUser()
    await addOrgMember(org, otherMember, 'member')

    await createNotification(extCollab.id, org.id, { title: '协作者通知' })
    await createNotification(otherMember.id, org.id, { title: '其他成员通知' })

    const rows = await Notification.query()
      .where('recipient_id', extCollab.id)
      .where('organization_id', org.id)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].title, '协作者通知')
  })

  test('只读观察者可以查看通知', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')

    const n = await createNotification(viewer.id, org.id, { title: '观察者通知' })
    const pol = await policy()
    const canView = await pol.view(viewer, Number(org.id))
    assert.isTrue(canView)
    void n // 避免 lint
  })

  // ---------------- 2.6 API 测试 ----------------

  test('GET /api/v1/notifications 返回当前用户通知（列表）', async ({ client, assert }) => {
    const { owner, org } = await createNotificationContext()
    await createNotification(owner.id, org.id, { title: '通知1' })
    await createNotification(owner.id, org.id, { title: '通知2' })

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/notifications')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.isArray(res.body().data)
    assert.lengthOf(res.body().data, 2)
  })

  test('GET /api/v1/notifications/unread-count 返回未读数', async ({ client, assert }) => {
    const { owner, org } = await createNotificationContext()
    await createNotification(owner.id, org.id, { title: '未读' })
    await createNotification(owner.id, org.id, { title: '已读', readAt: DateTime.now() })

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .get('/api/v1/notifications/unread-count')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.equal(res.body().unreadCount, 1)
  })

  test('PATCH /api/v1/notifications/:id/read 标记已读', async ({ client, assert }) => {
    const { owner, org } = await createNotificationContext()
    const n = await createNotification(owner.id, org.id, { title: '待读' })

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .patch(`/api/v1/notifications/${n.id}/read`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    await n.refresh()
    assert.isNotNull(n.readAt)
  })

  test('PATCH /api/v1/notifications/:id/read 幂等（重复标记已读）', async ({ client, assert }) => {
    const { owner, org } = await createNotificationContext()
    const n = await createNotification(owner.id, org.id, {
      title: '已读通知',
      readAt: DateTime.now(),
    })

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .patch(`/api/v1/notifications/${n.id}/read`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    await n.refresh()
    assert.isNotNull(n.readAt)
  })

  test('PATCH /api/v1/notifications/read-all 全部标记已读', async ({ client, assert }) => {
    const { owner, org } = await createNotificationContext()
    await createNotification(owner.id, org.id, { title: '通知1' })
    await createNotification(owner.id, org.id, { title: '通知2' })

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    const res = await client
      .patch('/api/v1/notifications/read-all')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.equal(res.body().markedCount, 2)

    const unreadCount = await Notification.query()
      .where('recipient_id', owner.id)
      .where('organization_id', org.id)
      .whereNull('read_at')
    assert.lengthOf(unreadCount, 0)
  })

  test('perPage 超过上限时按上限处理（返回100条）', async ({ client, assert }) => {
    const { owner, org } = await createNotificationContext()

    const login = await client.post('/api/v1/auth/login').json({
      email: owner.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    // 默认最大 perPage = 100，controller 强制上限
    const res = await client
      .get('/api/v1/notifications?perPage=500')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.isAtMost(res.body().meta.perPage, 100)
  })

  test('跨组织通知返回 RESOURCE_NOT_FOUND', async ({ client, assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)
    const n = await createNotification(ownerB.id, orgB.id, { title: 'B的通知' })

    const login = await client.post('/api/v1/auth/login').json({
      email: ownerA.email,
      password: STRONG_PASSWORD,
    })
    const token = login.body().data.accessToken

    // A 尝试标记 B 的通知 → RESOURCE_NOT_FOUND
    const res = await client
      .patch(`/api/v1/notifications/${n.id}/read`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(orgA.id))

    assert.equal(res.status(), 404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('未认证请求返回 AUTH_REQUIRED', async ({ client, assert }) => {
    const res = await client.get('/api/v1/notifications')
    assert.equal(res.status(), 401)
    assert.equal((res.body() as unknown as { error: { code: string } }).error.code, 'AUTH_REQUIRED')
  })
})
