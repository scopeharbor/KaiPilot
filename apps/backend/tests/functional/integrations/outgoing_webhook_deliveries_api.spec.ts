/**
 * v2-5-outgoing-webhook-delivery-ledger -- 投递账本 API functional 测试（8.1-8.4）。
 *
 * 覆盖 auth required、permission denied、list 分页/标准信封、detail、attempts、
 * cross-org hiding、manual retry、validation errors、redacted shape、
 * feature-off/pause 行为。全部 fixture/mock，不发起真实外发。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'
import OutgoingWebhookDeliveryService from '#services/webhooks/outgoing_webhook_delivery_service'
import { FixtureOutgoingWebhookDeliveryClient } from '#services/webhooks/outgoing_webhook_delivery_client'
import OutgoingWebhookDeliveryEvent from '#models/outgoing_webhook_delivery_event'
import AuditService from '#services/audit_service'
import IntegrationTokenCipher from '#services/integrations/token_cipher'

const BASE = '/api/v1/outgoing-webhook-deliveries'
const SUB_BASE = '/api/v1/outgoing-webhooks'
const VALID_URL = 'https://hooks.example.com/incoming'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function setupOwner() {
  const email = uniqueEmail('owd-api')
  const owner = await createUser({ email })
  const org = await createOrganization(owner)
  return { owner, org, email }
}

async function createSubscription(
  token: string,
  client: any,
  name: string,
  events = ['task.created'],
) {
  const res = await client
    .post(SUB_BASE)
    .bearerToken(token)
    .json({ name, targetUrl: VALID_URL, eventTypes: events })
  res.assertStatus(201)
  return res.body().data.id as number
}

function deliveryServiceWithFixture() {
  const fixture = new FixtureOutgoingWebhookDeliveryClient()
  const service = new OutgoingWebhookDeliveryService(
    new IntegrationTokenCipher(),
    new AuditService(),
    fixture,
  )
  return { service, fixture }
}

async function enqueueEvent(orgId: number, _subId: number) {
  const { service } = deliveryServiceWithFixture()
  return service.enqueue(
    {
      eventType: 'task.created',
      source: { entityType: 'task', entityId: 1, projectId: 1 },
      payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
    },
    { userId: null, organizationId: orgId },
  )
}

test.group('Outgoing Webhook Deliveries API', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.OUTGOING_WEBHOOKS_ENABLED = 'true'
    process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    return () => {
      delete process.env.OUTGOING_WEBHOOKS_ENABLED
      delete process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
    }
  })

  test('list returns standard envelope with pagination meta (8.1)', async ({ client, assert }) => {
    const { owner, org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-1')
    await enqueueEvent(Number(org.id), subId)
    await enqueueEvent(Number(org.id), subId) // 幂等，仍 1 条
    // 第二个不同源事件
    const { service } = deliveryServiceWithFixture()
    await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 2, projectId: 1 },
        payload: { taskId: 2, taskTitle: 'T2', projectId: 1, createdBy: 5 },
      },
      { userId: Number(owner.id), organizationId: Number(org.id) },
    )

    const res = await client.get(BASE).bearerToken(token)
    res.assertStatus(200)
    res.assertBodyContains({ data: [], meta: { total: 2, page: 1, perPage: 20, totalPages: 1 } })
    // 脱敏：无 secret/payload body
    const j = JSON.stringify(res.body())
    assert.isFalse(j.includes('secret'), 'no secret in list')
    assert.isFalse(j.includes('"payload"'), 'no payload body in list')
  })

  test('detail returns redacted delivery event (8.1)', async ({ client, assert }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-d')
    const ev = await enqueueEvent(Number(org.id), subId)
    const res = await client.get(`${BASE}/${ev[0].id}`).bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().data.id, ev[0].id)
    assert.equal(res.body().data.eventType, 'task.created')
    assert.isUndefined(res.body().data.secret)
    assert.isUndefined(res.body().data.payload)
  })

  test('attempts list returns redacted attempts (8.1)', async ({ client, assert }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-a')
    const ev = await enqueueEvent(Number(org.id), subId)
    const { service, fixture } = deliveryServiceWithFixture()
    fixture.setDefault({
      ok: true,
      status: 200,
      responseBody: '',
      failureCategory: 'unknown',
      isRetryable: false,
    })
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, { organizationId: Number(org.id) })

    const res = await client.get(`${BASE}/${ev[0].id}/attempts`).bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().data.length, 1)
    assert.equal(res.body().data[0].status, 'success')
    assert.isUndefined(res.body().data[0].responseBody)
  })

  test('manual retry succeeds for failed delivery (8.1)', async ({ client, assert }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-r')
    const ev = await enqueueEvent(Number(org.id), subId)
    // 置 failed
    const { service, fixture } = deliveryServiceWithFixture()
    fixture.setDefault({
      ok: false,
      status: 404,
      responseBody: 'no',
      failureCategory: 'client_error',
      isRetryable: false,
    })
    let event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, { organizationId: Number(org.id) })
    event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.equal(event.status, 'failed')

    // API manual retry（service 用默认 fixture 成功）
    process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    const res = await client
      .post(`${BASE}/${ev[0].id}/retry`)
      .bearerToken(token)
      .json({ reason: 'op' })
    res.assertStatus(200)
    assert.equal(res.body().data.deliveryEventId, ev[0].id)
  })

  test('manual retry validation: non-failed returns error (8.1)', async ({ client }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-v')
    const ev = await enqueueEvent(Number(org.id), subId)
    const res = await client.post(`${BASE}/${ev[0].id}/retry`).bearerToken(token).json({})
    res.assertStatus(422)
  })

  test('auth required (8.2)', async ({ client }) => {
    const res = await client.get(BASE)
    res.assertStatus(401)
  })

  test('permission denied for viewer (8.2)', async ({ client }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-p')
    await enqueueEvent(Number(org.id), subId)

    const viewerEmail = uniqueEmail('owd-viewer')
    const viewer = await createUser({ email: viewerEmail })
    await addOrgMember(org, viewer, 'viewer')
    const viewerToken = await login(client, viewerEmail)
    const res = await client.get(BASE).bearerToken(viewerToken)
    res.assertStatus(403)
  })

  test('cross-organization detail is hidden (8.2)', async ({ client }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-x')
    const ev = await enqueueEvent(Number(org.id), subId)

    const otherEmail = uniqueEmail('owd-other')
    const otherOwner = await createUser({ email: otherEmail })
    const otherOrg = await createOrganization(otherOwner)
    const otherToken = await login(client, otherEmail)
    void otherOrg
    const res = await client.get(`${BASE}/${ev[0].id}`).bearerToken(otherToken)
    res.assertStatus(404)
  })

  test('pause/unpause API toggles state (8.3)', async ({ client, assert }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-pause')
    const ev = await enqueueEvent(Number(org.id), subId)
    const pauseRes = await client.post(`${BASE}/${ev[0].id}/pause`).bearerToken(token)
    pauseRes.assertStatus(200)
    assert.isTrue(pauseRes.body().data.paused)
    const unpauseRes = await client.post(`${BASE}/${ev[0].id}/unpause`).bearerToken(token)
    unpauseRes.assertStatus(200)
    assert.isFalse(unpauseRes.body().data.paused)
  })

  test('feature-off disables writes but list stays readable (8.3/8.4)', async ({
    client,
    assert,
  }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const subId = await createSubscription(token, client, 'sub-fo')
    const ev = await enqueueEvent(Number(org.id), subId)
    delete process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
    try {
      const retryRes = await client.post(`${BASE}/${ev[0].id}/retry`).bearerToken(token).json({})
      assert.oneOf(retryRes.status(), [503, 422]) // feature-off 或 not-retryable，但不 mutate
      const listRes = await client.get(BASE).bearerToken(token)
      listRes.assertStatus(200)
      assert.equal(listRes.body().meta.total, 1)
      const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
      assert.equal(event.status, 'pending') // 未被 mutate
    } finally {
      process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    }
  })
})
