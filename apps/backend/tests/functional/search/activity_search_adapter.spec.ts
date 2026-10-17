import AuditLog from '#models/audit_log'
import type Organization from '#models/organization'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * 活动/审计搜索适配器集成测试（v2-advanced-search）：
 * - 非数字关键词不得被映射成 entity_id=0 造成误命中（修复回归）
 * - 非数字关键词仍可按 action/entity_type 文本命中
 * - 纯数字关键词命中 entity_id，且 matchedFields 如实标注 entity_id
 */

interface ActivityItem {
  entityType: string
  entityId: number
  matchedFields: string[]
  title: string
}

async function setupOwner(
  client: ApiClient,
): Promise<{ owner: User; org: Organization; token: string }> {
  const owner = await createUser()
  const org = await createOrganization(owner)
  const login = await client.post('/api/v1/auth/login').json({
    email: owner.email,
    password: STRONG_PASSWORD,
  })
  const token = login.body().data.accessToken
  return { owner, org, token }
}

test.group('高级搜索 - 活动适配器', (group) => {
  useAuthDatabase(group)

  test('非数字关键词不会命中 entity_id=0 的活动记录', async ({ client, assert }) => {
    const { org, token } = await setupOwner(client)
    await AuditLog.create({
      action: 'create',
      entityType: 'task',
      entityId: 0,
      severity: 'info',
      organizationId: org.id,
    })

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: '任意乱搜词xyz', entityTypes: ['activity'] })

    assert.equal(res.status(), 200)
    const items = (res.body().data as ActivityItem[]).filter((i) => i.entityType === 'activity')
    assert.equal(items.length, 0)
  })

  test('非数字关键词仍可按 action 文本命中', async ({ client, assert }) => {
    const { org, token } = await setupOwner(client)
    await AuditLog.create({
      action: 'ai_generate',
      entityType: 'task',
      entityId: 5,
      severity: 'info',
      organizationId: org.id,
    })

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: 'ai_generate', entityTypes: ['activity'] })

    assert.equal(res.status(), 200)
    const items = (res.body().data as ActivityItem[]).filter((i) => i.entityType === 'activity')
    assert.equal(items.length, 1)
    assert.include(items[0].matchedFields, 'action')
    assert.notInclude(items[0].matchedFields, 'entity_id')
  })

  test('非数字关键词可按 entity_type 文本命中', async ({ client, assert }) => {
    const { org, token } = await setupOwner(client)
    await AuditLog.create({
      action: 'update',
      entityType: 'milestone',
      entityId: 9,
      severity: 'info',
      organizationId: org.id,
    })

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: 'milestone', entityTypes: ['activity'] })

    assert.equal(res.status(), 200)
    const items = (res.body().data as ActivityItem[]).filter((i) => i.entityType === 'activity')
    assert.equal(items.length, 1)
    assert.include(items[0].matchedFields, 'action')
  })

  test('纯数字关键词命中 entity_id，且 matchedFields 标注 entity_id', async ({
    client,
    assert,
  }) => {
    const { org, token } = await setupOwner(client)
    await AuditLog.create({
      action: 'update',
      entityType: 'project',
      entityId: 42,
      severity: 'warning',
      organizationId: org.id,
    })

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: '42', entityTypes: ['activity'] })

    assert.equal(res.status(), 200)
    const items = (res.body().data as ActivityItem[]).filter((i) => i.entityType === 'activity')
    assert.equal(items.length, 1)
    assert.include(items[0].matchedFields, 'entity_id')
  })

  test('纯数字关键词不命中非该 entity_id 的活动记录', async ({ client, assert }) => {
    const { org, token } = await setupOwner(client)
    await AuditLog.create({
      action: 'delete',
      entityType: 'task',
      entityId: 7,
      severity: 'error',
      organizationId: org.id,
    })

    const res = await client
      .post('/api/v1/search')
      .header('Authorization', `Bearer ${token}`)
      .json({ keyword: '123', entityTypes: ['activity'] })

    assert.equal(res.status(), 200)
    const items = (res.body().data as ActivityItem[]).filter((i) => i.entityType === 'activity')
    assert.equal(items.length, 0)
  })
})
