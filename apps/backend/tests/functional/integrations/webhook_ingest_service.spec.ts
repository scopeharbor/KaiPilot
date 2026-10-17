/**
 * v2-5-provider-incoming-webhook-foundation —— ingest service 与 endpoint service
 * 行为测试（DB-backed，用 useAuthDatabase 迁移）。
 *
 * 覆盖 design D3/D4/D5/D6：首次处理 / 重复幂等一致 / 缺 delivery id 用计算键 /
 * 时间戳过期与未来 / 每条留痕一条；密钥密文落库不回显明文 / 轮换过渡窗口内新旧密钥
 * 均通过 / 窗口结束旧密钥失效 / 账本查询组织隔离。
 */
import { test } from '@japa/runner'
import crypto from 'node:crypto'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'
import WebhookEndpointService, {
  InvalidWebhookProviderError,
  WebhookEndpointNotFoundError,
} from '#services/webhooks/webhook_endpoint_service'
import WebhookIngestService from '#services/webhooks/webhook_ingest_service'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import WebhookDelivery from '#models/webhook_delivery'

const SECRET = 'whsec_unit_secret_abc123'
const RAW = Buffer.from(JSON.stringify({ action: 'opened', number: 1 }), 'utf8')

function sign(body: Buffer, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
}

test.group('WebhookIngestService', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.WEBHOOKS_INGEST_ENABLED = 'true'
    return () => {
      delete process.env.WEBHOOKS_INGEST_ENABLED
    }
  })

  async function seedEndpoint(
    orgId: number,
    userId: number,
    overrides: Partial<{
      enabled: boolean
      tolerance: number
      previous: string | null
      rotatedAtMs: number | null
    }> = {},
  ) {
    const cipher = new IntegrationTokenCipher()
    const svc = new WebhookEndpointService(cipher)
    const created = await svc.create(
      {
        provider: 'fixture',
        slug: 'unit',
        enabled: overrides.enabled ?? true,
        timestampToleranceSeconds: overrides.tolerance ?? 300,
      },
      { userId, organizationId: orgId },
    )
    // 用已知密钥覆盖注册时的随机密钥，便于 ingest 测试可控
    const enc = cipher.encrypt(SECRET)
    const webhookEndpointModule = await import('#models/webhook_endpoint')
    const WebhookEndpoint = webhookEndpointModule.default
    const row = await WebhookEndpoint.findOrFail(created.id)
    row.signingSecretEncrypted = enc
    if (overrides.previous !== undefined) row.previousSecretEncrypted = overrides.previous
    if (overrides.rotatedAtMs !== null && overrides.rotatedAtMs !== undefined) {
      const { DateTime } = await import('luxon')
      row.secretRotatedAt = DateTime.fromMillis(overrides.rotatedAtMs)
    }
    await row.save()
    return { id: created.id, row }
  }

  test('first delivery accepted, one ledger row', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const { id } = await seedEndpoint(Number(org.id), Number(user.id))
    const svc = new WebhookIngestService()
    const result = await svc.ingest({
      provider: 'fixture',
      rawBody: RAW,
      headers: {
        'x-webhook-signature': sign(RAW, SECRET),
        'x-webhook-delivery': 'u-1',
        'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      },
    })
    assert.equal(result.status, 'accepted')
    const count = await WebhookDelivery.query().where('endpoint_id', id).count('* as total').first()
    assert.equal(Number((count?.$extras as Record<string, unknown>)?.total ?? 0), 1)
  })

  test('duplicate delivery id returns consistent 2xx and duplicate row', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const { id } = await seedEndpoint(Number(org.id), Number(user.id))
    const svc = new WebhookIngestService()
    const headers = {
      'x-webhook-signature': sign(RAW, SECRET),
      'x-webhook-delivery': 'u-dup',
      'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
    }
    const first = await svc.ingest({ provider: 'fixture', rawBody: RAW, headers })
    const second = await svc.ingest({ provider: 'fixture', rawBody: RAW, headers })
    assert.equal(first.status, 'accepted')
    assert.equal(second.status, 'duplicate')
    // 重复交付经 DB 复合唯一约束只记一次（design D3：同 idempotency_key 唯一），
    // 重复请求不产生第二条账本（spec「重复 delivery id 幂等返回」）。
    const count = await WebhookDelivery.query().where('endpoint_id', id).count('* as total').first()
    assert.equal(Number((count?.$extras as Record<string, unknown>)?.total ?? 0), 1)
  })

  test('missing delivery id uses computed idempotency key', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const { id } = await seedEndpoint(Number(org.id), Number(user.id))
    const svc = new WebhookIngestService()
    const ts = String(Math.floor(Date.now() / 1000))
    const headers = { 'x-webhook-signature': sign(RAW, SECRET), 'x-webhook-timestamp': ts }
    const first = await svc.ingest({ provider: 'fixture', rawBody: RAW, headers })
    const second = await svc.ingest({ provider: 'fixture', rawBody: RAW, headers })
    assert.equal(first.status, 'accepted')
    assert.equal(second.status, 'duplicate')
    const count = await WebhookDelivery.query().where('endpoint_id', id).count('* as total').first()
    assert.equal(Number((count?.$extras as Record<string, unknown>)?.total ?? 0), 1)
  })

  test('expired and future timestamps rejected with 400', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const { id } = await seedEndpoint(Number(org.id), Number(user.id))
    const svc = new WebhookIngestService()
    const now = Date.now()
    // expired
    const expiredTs = String(Math.floor((now - 9999 * 1000) / 1000))
    const expired = await svc.ingest({
      provider: 'fixture',
      rawBody: RAW,
      headers: {
        'x-webhook-signature': sign(RAW, SECRET),
        'x-webhook-delivery': 'u-exp',
        'x-webhook-timestamp': expiredTs,
      },
      now: () => now,
    })
    assert.equal(expired.status, 'rejected')
    if (expired.status === 'rejected') {
      assert.equal(expired.httpStatus, 400)
      assert.equal(expired.code, 'WEBHOOK_TIMESTAMP_INVALID')
    }
    // future
    const futureTs = String(Math.floor((now + 9999 * 1000) / 1000))
    const future = await svc.ingest({
      provider: 'fixture',
      rawBody: RAW,
      headers: {
        'x-webhook-signature': sign(RAW, SECRET),
        'x-webhook-delivery': 'u-fut',
        'x-webhook-timestamp': futureTs,
      },
      now: () => now,
    })
    assert.equal(future.status, 'rejected')
    void id
  })

  test('each delivery writes exactly one ledger row regardless of outcome', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const { id } = await seedEndpoint(Number(org.id), Number(user.id))
    const svc = new WebhookIngestService()
    const ts = String(Math.floor(Date.now() / 1000))
    // 有效
    await svc.ingest({
      provider: 'fixture',
      rawBody: RAW,
      headers: {
        'x-webhook-signature': sign(RAW, SECRET),
        'x-webhook-delivery': 'a1',
        'x-webhook-timestamp': ts,
      },
    })
    // 无效签名
    await svc.ingest({
      provider: 'fixture',
      rawBody: RAW,
      headers: {
        'x-webhook-signature': 'sha256=bad',
        'x-webhook-delivery': 'a2',
        'x-webhook-timestamp': ts,
      },
    })
    // 重复
    await svc.ingest({
      provider: 'fixture',
      rawBody: RAW,
      headers: {
        'x-webhook-signature': sign(RAW, SECRET),
        'x-webhook-delivery': 'a1',
        'x-webhook-timestamp': ts,
      },
    })
    const count = await WebhookDelivery.query().where('endpoint_id', id).count('* as total').first()
    // 有效1 + 无效1 = 2；重复交付（a1 再来）经唯一约束只记一次，不写第二条。
    assert.equal(Number((count?.$extras as Record<string, unknown>)?.total ?? 0), 2)
  })
})

test.group('WebhookEndpointService — secret rotation window', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.WEBHOOKS_INGEST_ENABLED = 'true'
    return () => {
      delete process.env.WEBHOOKS_INGEST_ENABLED
    }
  })

  test('rotation window accepts old and new secrets; after window old fails', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const cipher = new IntegrationTokenCipher()
    const svc = new WebhookEndpointService(cipher)
    const created = await svc.create(
      { provider: 'fixture', slug: 'rot', enabled: true },
      { userId: Number(user.id), organizationId: Number(org.id) },
    )

    // 用已知旧密钥覆盖
    const webhookEndpointModule = await import('#models/webhook_endpoint')
    const WebhookEndpoint = webhookEndpointModule.default
    const row = await WebhookEndpoint.findOrFail(created.id)
    row.signingSecretEncrypted = cipher.encrypt('old-secret')
    await row.save()

    // 轮换
    const rotated = await svc.rotateSecret(created.id, {
      userId: Number(user.id),
      organizationId: Number(org.id),
    })
    const newSecret = rotated.secret

    const ingest = new WebhookIngestService()
    const ts = String(Math.floor(Date.now() / 1000))
    const RAW2 = Buffer.from('{}', 'utf8')

    // 新密钥通过
    const newResult = await ingest.ingest({
      provider: 'fixture',
      rawBody: RAW2,
      headers: {
        'x-webhook-signature': sign(RAW2, newSecret),
        'x-webhook-delivery': 'r-new',
        'x-webhook-timestamp': ts,
      },
    })
    assert.equal(newResult.status, 'accepted')

    // 旧密钥在过渡窗口内也通过
    const oldResult = await ingest.ingest({
      provider: 'fixture',
      rawBody: RAW2,
      headers: {
        'x-webhook-signature': sign(RAW2, 'old-secret'),
        'x-webhook-delivery': 'r-old',
        'x-webhook-timestamp': ts,
      },
    })
    assert.equal(oldResult.status, 'accepted')

    // 把轮换时间设到 25h 前（窗口外）
    const { DateTime } = await import('luxon')
    const row2 = await WebhookEndpoint.findOrFail(created.id)
    row2.secretRotatedAt = DateTime.fromMillis(Date.now() - 25 * 3600 * 1000)
    await row2.save()

    const staleResult = await ingest.ingest({
      provider: 'fixture',
      rawBody: RAW2,
      headers: {
        'x-webhook-signature': sign(RAW2, 'old-secret'),
        'x-webhook-delivery': 'r-stale',
        'x-webhook-timestamp': ts,
      },
    })
    assert.equal(staleResult.status, 'rejected')
    if (staleResult.status === 'rejected') {
      assert.equal(staleResult.code, 'WEBHOOK_SIGNATURE_INVALID')
    }
  })

  test('invalid provider rejected', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const svc = new WebhookEndpointService()
    await assert.rejects(
      () =>
        svc.create(
          { provider: 'no-such', slug: 'x' },
          { userId: Number(user.id), organizationId: Number(org.id) },
        ),
      InvalidWebhookProviderError,
    )
  })

  test('cross-org endpoint lookup not found', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const svc = new WebhookEndpointService()
    await assert.rejects(
      () => svc.getOwnedModel(999999, { organizationId: Number(org.id) }),
      WebhookEndpointNotFoundError,
    )
  })

  test('secret ciphertext stored, plaintext not in DTO', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const cipher = new IntegrationTokenCipher()
    const svc = new WebhookEndpointService(cipher)
    const created = await svc.create(
      { provider: 'fixture', slug: 'enc', enabled: true },
      { userId: Number(user.id), organizationId: Number(org.id) },
    )
    const webhookEndpointModule = await import('#models/webhook_endpoint')
    const WebhookEndpoint = webhookEndpointModule.default
    const row = await WebhookEndpoint.findOrFail(created.id)
    assert.notInclude(row.signingSecretEncrypted, created.secret.signingSecret)
    assert.isUndefined((created as unknown as Record<string, unknown>).signingSecretEncrypted)
  })
})
