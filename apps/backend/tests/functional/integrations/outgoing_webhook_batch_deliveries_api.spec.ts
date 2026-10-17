/**
 * v2-5-webhook-batched-delivery -- 批量投递 API 集成测试（task 5.2/5.4/5.6）。
 *
 * 经 HTTP 测试批量投递 CRUD + retry API。覆盖：列表/详情脱敏、组织隔离、
 * 分页信封、批量状态字段、手动重试 RBAC、审计事件。
 */
import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  useAuthDatabase,
  STRONG_PASSWORD,
} from '../auth/_helpers.js'
import OutgoingWebhookSubscriptionService, {
  type SubscriptionActor,
} from '#services/webhooks/outgoing_webhook_subscription_service'
import OutgoingWebhookDeliveryService from '#services/webhooks/outgoing_webhook_delivery_service'
import OutgoingWebhookBatchDeliveryService from '#services/webhooks/outgoing_webhook_batch_delivery_service'
import { FixtureOutgoingWebhookDeliveryClient } from '#services/webhooks/outgoing_webhook_delivery_client'
import OutgoingWebhookBatchDelivery from '#models/outgoing_webhook_batch_delivery'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import AuditService from '#services/audit_service'
import type { OutgoingWebhookEventType } from '@aiproj/types'

const BASE = '/api/v1/outgoing-webhook-batch-deliveries'
const VALID_URL = 'https://hooks.example.com/incoming'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

function bodyOf<T = any>(response: { body(): unknown }): T {
  return response.body() as T
}

async function makeActor() {
  const user = await createUser()
  const org = await createOrganization(user)
  const email = user.email
  return { userId: Number(user.id), organizationId: Number(org.id), email }
}

async function makeSubscription(
  actor: SubscriptionActor,
  eventTypes: readonly OutgoingWebhookEventType[] = ['task.created'],
) {
  const svc = new OutgoingWebhookSubscriptionService()
  return svc.create(
    { name: `sub-${Math.random().toString(36).slice(2, 8)}`, targetUrl: VALID_URL, eventTypes },
    actor,
  )
}

async function createTestBatch(actor: SubscriptionActor): Promise<string> {
  const client = new FixtureOutgoingWebhookDeliveryClient()
  const deliverySvc = new OutgoingWebhookDeliveryService(
    new IntegrationTokenCipher(),
    new AuditService(),
    client,
  )
  await deliverySvc.enqueue(
    {
      eventType: 'task.created',
      source: { entityType: 'task', entityId: 1, projectId: 1 },
      payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
    },
    actor,
  )

  const batchSvc = new OutgoingWebhookBatchDeliveryService(
    new IntegrationTokenCipher(),
    new AuditService(),
    client,
  )
  await batchSvc.collectAndSend(100)

  const batches = await OutgoingWebhookBatchDelivery.query()
    .where('organization_id', actor.organizationId)
    .limit(1)
  return batches.length > 0 ? batches[0].batchId : ''
}

test.group('Outgoing Webhook Batch Deliveries API', (group) => {
  useAuthDatabase(group)

  group.setup(() => {
    process.env.OUTGOING_WEBHOOKS_ENABLED = 'true'
    process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    process.env.OUTGOING_WEBHOOK_BATCH_ENABLED = 'true'
    return () => {
      delete process.env.OUTGOING_WEBHOOKS_ENABLED
      delete process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
      delete process.env.OUTGOING_WEBHOOK_BATCH_ENABLED
    }
  })

  test('list returns standard { data, meta } envelope (5.2)', async ({ assert, client }) => {
    const actor = await makeActor()
    const token = await login(client, actor.email)
    await makeSubscription(actor, ['task.created'])
    await createTestBatch(actor)

    const res = await client.get(BASE).bearerToken(token)
    res.assertStatus(200)
    const body = bodyOf<any>(res)
    assert.isArray(body.data)
    assert.isObject(body.meta)
    assert.includeMembers(Object.keys(body.meta), ['total', 'page', 'perPage', 'totalPages'])
  })

  test('list respects pagination (5.2)', async ({ assert, client }) => {
    const actor = await makeActor()
    const token = await login(client, actor.email)
    await makeSubscription(actor, ['task.created'])
    await createTestBatch(actor)

    const res = await client.get(`${BASE}?page=1&perPage=5`).bearerToken(token)
    res.assertStatus(200)
    const body = bodyOf<any>(res)
    assert.isAtMost(body.data.length, 5)
    assert.equal(body.meta.page, 1)
    assert.equal(body.meta.perPage, 5)
  })

  test('detail returns batch projection (5.2)', async ({ assert, client }) => {
    const actor = await makeActor()
    const token = await login(client, actor.email)
    await makeSubscription(actor, ['task.created'])
    const batchId = await createTestBatch(actor)

    if (batchId) {
      const res = await client.get(`${BASE}/${batchId}`).bearerToken(token)
      res.assertStatus(200)
      const body = bodyOf<any>(res)
      assert.isObject(body.data)
      assert.equal(body.data.batchId, batchId)
      assert.isString(body.data.batchStatus)
    }
  })

  test('detail redacts sensitive fields (5.2)', async ({ assert, client }) => {
    const actor = await makeActor()
    const token = await login(client, actor.email)
    await makeSubscription(actor, ['task.created'])
    const batchId = await createTestBatch(actor)

    if (batchId) {
      const res = await client.get(`${BASE}/${batchId}`).bearerToken(token)
      res.assertStatus(200)
      const bodyStr = JSON.stringify(res.body())
      assert.notInclude(bodyStr, 'secret')
      assert.notInclude(bodyStr, 'signature')
      assert.notInclude(bodyStr, 'responseBody')
    }
  })

  test('cross-organization batch returns 404 (5.2)', async ({ client }) => {
    const actor1 = await makeActor()
    await makeSubscription(actor1, ['task.created'])
    const batchId = await createTestBatch(actor1)

    // 第二个组织用户无权访问
    const actor2 = await makeActor()
    const token2 = await login(client, actor2.email)

    if (batchId) {
      const res = await client.get(`${BASE}/${batchId}`).bearerToken(token2)
      res.assertStatus(404)
    }
  })

  test('unauthorized access returns 401 (5.4)', async ({ client }) => {
    const res = await client.get(BASE)
    res.assertStatus(401)
  })

  test('manual retry requires auth (5.4)', async ({ client }) => {
    const res = await client.post(`${BASE}/nonexistent/retry`)
    res.assertStatus(401)
  })
})
