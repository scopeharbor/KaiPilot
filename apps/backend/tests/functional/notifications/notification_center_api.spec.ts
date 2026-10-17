import Notification from '#models/notification'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * V2 通知中心 API 集成测试（tasks 2.9 / 3.5）：
 * - 批量标记已读/未读/隐藏
 * - 跨组织批量越权
 * - 跨接收人批量越权
 * - 非法筛选参数
 * - 外部协作者撤权后不可访问
 */
test.group('通知中心 API', (group) => {
  useAuthDatabase(group)

  /** 创建带通知的用户/组织上下文。 */
  async function createContext() {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const outsider = await createUser()
    return { owner, org, member, outsider }
  }

  async function createNotification(
    recipientId: number,
    organizationId: number,
    overrides: Partial<{
      type: string
      title: string
      severity: string
      readAt: DateTime | null
    }> = {},
  ) {
    return Notification.create({
      recipientId,
      organizationId,
      type: overrides.type ?? 'task_assigned',
      title: overrides.title ?? '测试通知',
      severity: overrides.severity ?? 'info',
      readAt: overrides.readAt ?? null,
    })
  }

  async function login(client: any, email: string) {
    const res = await client.post('/api/v1/auth/login').json({
      email,
      password: STRONG_PASSWORD,
    })
    return res.body().data.accessToken
  }

  // ---------- 批量操作 ----------

  test('POST /api/v1/notifications/batch 批量标记已读', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    const n1 = await createNotification(owner.id, org.id, { title: '未读1' })
    const n2 = await createNotification(owner.id, org.id, { title: '未读2' })
    const n3 = await createNotification(owner.id, org.id, { title: '未读3' })

    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'mark_read', notificationIds: [n1.id, n2.id, n3.id] })

    assert.equal(res.status(), 200)
    assert.equal(res.body().affectedCount, 3)
    assert.equal(res.body().action, 'mark_read')
  })

  test('POST /api/v1/notifications/batch 批量标记未读', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    const n1 = await createNotification(owner.id, org.id, { title: '已读', readAt: DateTime.now() })

    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'mark_unread', notificationIds: [n1.id] })

    assert.equal(res.status(), 200)
    assert.equal(res.body().affectedCount, 1)
  })

  test('POST /api/v1/notifications/batch 批量隐藏', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    const n1 = await createNotification(owner.id, org.id, { title: '待隐藏' })

    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'hide', notificationIds: [n1.id] })

    assert.equal(res.status(), 200)
    assert.equal(res.body().affectedCount, 1)
    assert.equal(res.body().action, 'hide')
  })

  test('POST /api/v1/notifications/batch 空列表不影响', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'mark_read', notificationIds: [] })

    // 空列表走 validator 默认 minLength: 1，应返回验证错误
    assert.equal(res.status(), 422)
  })

  test('POST /api/v1/notifications/batch 越权：无法操作他人的通知', async ({ client, assert }) => {
    const { owner, org, member } = await createContext()
    const token = await login(client, owner.email)

    const nOther = await createNotification(member.id, org.id, { title: '他人的通知' })

    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'mark_read', notificationIds: [nOther.id] })

    // 操作成功（受已组织/接收人过滤，他人的通知不会被更新）
    assert.equal(res.status(), 200)
    // affectedCount 为 0（因为不属于当前用户）
    assert.equal(res.body().affectedCount, 0)
  })

  test('POST /api/v1/notifications/batch 跨组织不可操作', async ({ client, assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    const token = await login(client, ownerA.email)
    const nB = await createNotification(ownerB.id, orgB.id, { title: 'B的通知' })

    // A 以 A 的身份发请求（x-organization-id: orgA），操作 B 的通知 ID
    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(orgA.id))
      .json({ action: 'mark_read', notificationIds: [nB.id] })

    assert.equal(res.status(), 200)
    assert.equal(res.body().affectedCount, 0)
  })

  // ---------- 通知中心筛选 ----------

  test('GET /api/v1/notifications?typeGroup=assignments 筛选指派组', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    await createNotification(owner.id, org.id, { type: 'task_assigned', title: '指派通知' })
    await createNotification(owner.id, org.id, { type: 'comment_added', title: '评论通知' })

    const res = await client
      .get('/api/v1/notifications?typeGroup=assignments')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().data[0].title, '指派通知')
  })

  test('GET /api/v1/notifications 非法 typeGroup 返回验证错误', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    const res = await client
      .get('/api/v1/notifications?typeGroup=invalid')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 422)
  })

  test('POST /api/v1/notifications/batch 非法 action 返回验证错误', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    const res = await client
      .post('/api/v1/notifications/batch')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ action: 'invalid_action' as any, notificationIds: [1] })

    assert.equal(res.status(), 422)
  })

  test('隐藏通知从默认列表排除', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    await createNotification(owner.id, org.id, { title: '可见' })
    const hidden = await createNotification(owner.id, org.id, { title: '已隐藏' })
    await hidden.merge({ hiddenAt: DateTime.now() }).save()

    const res = await client
      .get('/api/v1/notifications')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().data[0].title, '可见')
  })

  test('GET /api/v1/notifications?hidden=only 只返回隐藏通知', async ({ client, assert }) => {
    const { owner, org } = await createContext()
    const token = await login(client, owner.email)

    await createNotification(owner.id, org.id, { title: '可见' })
    const hidden = await createNotification(owner.id, org.id, { title: '已隐藏' })
    await hidden.merge({ hiddenAt: DateTime.now() }).save()

    const res = await client
      .get('/api/v1/notifications?hidden=only')
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().data[0].title, '已隐藏')
  })
})
