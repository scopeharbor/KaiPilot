/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理 API functional 测试。
 *
 * 覆盖 spec 全场景：happy path、白名单校验、URL 保守校验、一次性密钥、脱敏投影、
 * 跨组织隔离、RBAC PERMISSION_DENIED、未认证、feature-off、no-delivery 零出站。
 * 全部 fixture/mock，不发起真实外发。
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
import OutgoingWebhookSubscription from '#models/outgoing_webhook_subscription'
import AuditLog from '#models/audit_log'
import IntegrationTokenCipher from '#services/integrations/token_cipher'

const BASE = '/api/v1/outgoing-webhooks'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

function dataOf<T = any>(response: { body(): unknown }): T {
  return (response.body() as any).data as T
}

async function setupOwner() {
  const email = uniqueEmail('owh-api')
  const owner = await createUser({ email })
  const org = await createOrganization(owner)
  return { owner, org, email }
}

const VALID_URL = 'https://hooks.example.com/incoming'
const VALID_EVENTS = ['task.created', 'task.updated']

test.group('Outgoing Webhook Subscriptions API', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.OUTGOING_WEBHOOKS_ENABLED = 'true'
    return () => {
      delete process.env.OUTGOING_WEBHOOKS_ENABLED
    }
  })

  test('list returns empty for new organization', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client.get(BASE).bearerToken(token)
    res.assertStatus(200)
    res.assertBodyContains({ data: [] })
  })

  test('create returns one-time secret and redacted list omits it', async ({ client, assert }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: '我的订阅', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    res.assertStatus(201)
    const created = dataOf(res)
    assert.isDefined(created.secret)
    assert.isString(created.secret.secret)
    assert.isString(created.secret.fingerprint)
    // 脱敏投影不含密钥明文/密文
    assert.isUndefined(created.secretCiphertext)

    // list 不含 secret
    const list = await client.get(BASE).bearerToken(token)
    list.assertStatus(200)
    const item = dataOf<any[]>(list)[0]
    assert.isUndefined(item.secret)
    assert.isUndefined(item.secretCiphertext)
    assert.equal(item.status, 'active')
    assert.deepEqual(item.eventTypes.sort(), [...VALID_EVENTS].sort())
  })

  test('create persists encrypted secret material, plaintext not stored', async ({
    client,
    assert,
  }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'enc-check', targetUrl: VALID_URL, eventTypes: ['risk.created'] })
    const created = dataOf(res)
    const plainSecret = created.secret.secret as string
    const id = created.id as number

    const row = await OutgoingWebhookSubscription.findOrFail(id)
    assert.notEqual(row.secretCiphertext, plainSecret)
    // 密文可解密回原明文（证明加密边界正确）
    assert.equal(new IntegrationTokenCipher().decrypt(row.secretCiphertext), plainSecret)
    assert.equal(row.secretFingerprint, created.secret.fingerprint)
  })

  test('rejects unknown event type with VALIDATION_ERROR', async ({ client, assert }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'bad-event', targetUrl: VALID_URL, eventTypes: ['project.deleted'] })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    const count = await OutgoingWebhookSubscription.query().count('* as total').first()
    assert.equal(Number((count?.$extras as Record<string, unknown>)?.total ?? 0), 0)
  })

  test('rejects empty event list', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'no-events', targetUrl: VALID_URL, eventTypes: [] })
    res.assertStatus(422)
  })

  test('rejects non-HTTPS target URL', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client.post(BASE).bearerToken(token).json({
      name: 'http-url',
      targetUrl: 'http://insecure.example/hook',
      eventTypes: VALID_EVENTS,
    })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('rejects javascript: scheme URL', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'xss', targetUrl: 'javascript:alert(1)', eventTypes: VALID_EVENTS })
    res.assertStatus(422)
  })

  test('rejects credential-bearing URL', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client.post(BASE).bearerToken(token).json({
      name: 'creds',
      targetUrl: 'https://user:pass@hooks.example.com/incoming',
      eventTypes: VALID_EVENTS,
    })
    res.assertStatus(422)
  })

  test('rejects loopback target URL', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const res = await client.post(BASE).bearerToken(token).json({
      name: 'loopback',
      targetUrl: 'https://127.0.0.1:9000/hook',
      eventTypes: VALID_EVENTS,
    })
    res.assertStatus(422)
  })

  test('update changes name and event types, no secret exposure', async ({ client, assert }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const created = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: '原名', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    const id = dataOf(created).id as number

    const res = await client
      .patch(`${BASE}/${id}`)
      .bearerToken(token)
      .json({ name: '新名', eventTypes: ['task.completed'] })
    res.assertStatus(200)
    const updated = dataOf(res)
    assert.equal(updated.name, '新名')
    assert.deepEqual(updated.eventTypes, ['task.completed'])
    assert.isUndefined(updated.secret)
  })

  test('deactivate marks inactive and keeps visible', async ({ client, assert }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const created = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'to-deactivate', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    const id = dataOf(created).id as number

    const res = await client.post(`${BASE}/${id}/deactivate`).bearerToken(token)
    res.assertStatus(200)
    const deactivated = dataOf(res)
    assert.equal(deactivated.status, 'inactive')
    assert.isNotNull(deactivated.deactivatedAt)

    // list 仍可见（inactive）
    const list = await client.get(BASE).bearerToken(token)
    list.assertStatus(200)
    assert.equal(dataOf<any[]>(list)[0].status, 'inactive')
  })

  test('rotate returns new one-time secret and changes fingerprint', async ({ client, assert }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const created = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'to-rotate', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    const createdData = dataOf(created)
    const oldSecret = createdData.secret.secret as string
    const oldFingerprint = createdData.secret.fingerprint as string
    const id = createdData.id as number

    const res = await client.post(`${BASE}/${id}/rotate`).bearerToken(token)
    res.assertStatus(200)
    const rotated = dataOf(res)
    const newSecret = rotated.secret.secret as string
    const newFingerprint = rotated.secret.fingerprint as string
    assert.notEqual(newSecret, oldSecret)
    assert.notEqual(newFingerprint, oldFingerprint)
    // 旧密钥不可再取回：list/detail 无 secret
    const detail = await client.get(BASE).bearerToken(token)
    assert.isUndefined(dataOf<any[]>(detail)[0].secret)
  })

  test('cross-organization access returns RESOURCE_NOT_FOUND', async ({ client }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const created = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'org-a-sub', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    const id = dataOf(created).id as number

    // org B 的 owner
    const emailB = uniqueEmail('owh-api-b')
    const ownerB = await createUser({ email: emailB })
    await createOrganization(ownerB)
    const tokenB = await login(client, emailB)

    const res = await client.patch(`${BASE}/${id}`).bearerToken(tokenB).json({ name: 'hijack' })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('viewer role gets PERMISSION_DENIED', async ({ client }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    // owner 先建一个订阅
    const created = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'owner-sub', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })

    // viewer 成员
    const viewerEmail = uniqueEmail('owh-viewer')
    const viewer = await createUser({ email: viewerEmail })
    await addOrgMember(org, viewer, 'viewer')
    const viewerToken = await login(client, viewerEmail)

    const createRes = await client
      .post(BASE)
      .bearerToken(viewerToken)
      .json({ name: 'viewer-sub', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    createRes.assertStatus(403)
    createRes.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const rotateRes = await client
      .post(`${BASE}/${dataOf(created).id}/rotate`)
      .bearerToken(viewerToken)
    rotateRes.assertStatus(403)
  })

  test('unauthenticated request returns AUTH_REQUIRED', async ({ client }) => {
    const res = await client.get(BASE)
    res.assertStatus(401)
  })

  test('audit event written on create without plaintext secret', async ({ client, assert }) => {
    const { org, email } = await setupOwner()
    const token = await login(client, email)
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'audit-sub', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    const plainSecret = dataOf(res).secret.secret as string

    const logs = await AuditLog.query()
      .where('organization_id', Number(org.id))
      .where('entity_type', 'outgoing_webhook_subscription')
    assert.isAbove(logs.length, 0)
    const blob = JSON.stringify(logs)
    assert.notInclude(blob, plainSecret, '审计不得包含密钥明文')
    assert.notInclude(blob, '"secretCiphertext"', '审计不得包含密文字段')
  })

  test('creating subscription does not send any outbound HTTP', async ({ client, assert }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)
    const spyCalls: string[] = []
    const origFetch = (globalThis as any).fetch
    ;(globalThis as any).fetch = (...args: unknown[]) => {
      spyCalls.push(String(args[0]))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    try {
      await client.post(BASE).bearerToken(token).json({
        name: 'no-delivery',
        targetUrl: 'https://hooks.example.com/incoming',
        eventTypes: VALID_EVENTS,
      })
      assert.equal(spyCalls.length, 0, '订阅创建不得发起任何外发 HTTP')
    } finally {
      ;(globalThis as any).fetch = origFetch
    }
  })
})

test.group('Outgoing Webhook Subscriptions API - feature off', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    delete process.env.OUTGOING_WEBHOOKS_ENABLED
    return () => {
      delete process.env.OUTGOING_WEBHOOKS_ENABLED
    }
  })

  test('write operations return 503 FEATURE_DISABLED while list stays available', async ({
    client,
    assert,
  }) => {
    const { email } = await setupOwner()
    const token = await login(client, email)

    const createRes = await client
      .post(BASE)
      .bearerToken(token)
      .json({ name: 'disabled-sub', targetUrl: VALID_URL, eventTypes: VALID_EVENTS })
    createRes.assertStatus(503)
    createRes.assertBodyContains({ error: { code: 'FEATURE_DISABLED' } })

    const count = await OutgoingWebhookSubscription.query().count('* as total').first()
    assert.equal(Number((count?.$extras as Record<string, unknown>)?.total ?? 0), 0)

    // list 仍安全可用
    const list = await client.get(BASE).bearerToken(token)
    list.assertStatus(200)
  })
})
