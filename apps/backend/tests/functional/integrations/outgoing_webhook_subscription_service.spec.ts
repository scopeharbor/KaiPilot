/**
 * v2-5-outgoing-webhook-subscription-foundation -- 订阅 Service 单元/集成测试。
 *
 * 直接调用 OutgoingWebhookSubscriptionService，不经 HTTP/RBAC。覆盖密钥加密边界、
 * 一次性明文、fingerprint、轮换、停用、白名单/URL 校验、组织隔离、feature-off、
 * no-delivery guard（任务 3.4/4.4/4.7/4.8）。
 */
import { test } from '@japa/runner'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'
import OutgoingWebhookSubscriptionService, {
  OutgoingWebhookEventRejectedError,
  OutgoingWebhookFeatureDisabledError,
  OutgoingWebhookSubscriptionNotFoundError,
} from '#services/webhooks/outgoing_webhook_subscription_service'
import OutgoingWebhookSubscription from '#models/outgoing_webhook_subscription'
import AuditLog from '#models/audit_log'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import type { SubscriptionActor } from '#services/webhooks/outgoing_webhook_subscription_service'

const VALID_URL = 'https://hooks.example.com/incoming'

async function makeActor(): Promise<SubscriptionActor> {
  const user = await createUser()
  const org = await createOrganization(user)
  return { userId: Number(user.id), organizationId: Number(org.id) }
}

test.group('Outgoing Webhook Subscription Service', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.OUTGOING_WEBHOOKS_ENABLED = 'true'
    return () => {
      delete process.env.OUTGOING_WEBHOOKS_ENABLED
    }
  })

  test('create persists encrypted material and returns plaintext once', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'sub-1', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actor,
    )
    assert.isString(created.secret.secret)
    assert.equal(created.secret.fingerprint, created.secretFingerprint)

    const row = await OutgoingWebhookSubscription.findOrFail(created.id)
    assert.notEqual(row.secretCiphertext, created.secret.secret)
    assert.equal(new IntegrationTokenCipher().decrypt(row.secretCiphertext), created.secret.secret)
    assert.equal(row.status, 'active')
    assert.deepEqual(row.eventTypes, ['task.created'])
    assert.equal(row.organizationId, actor.organizationId)
  })

  test('rotate replaces secret, updates fingerprint and timestamp, old plaintext unrecoverable', async ({
    assert,
  }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'sub-rot', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actor,
    )
    const oldPlain = created.secret.secret
    const oldFingerprint = created.secretFingerprint

    const rotated = await svc.rotateSecret(created.id, actor)
    assert.notEqual(rotated.secret.secret, oldPlain)
    assert.notEqual(rotated.secret.fingerprint, oldFingerprint)
    assert.notEqual(rotated.secretFingerprint, oldFingerprint)

    const row = await OutgoingWebhookSubscription.findOrFail(created.id)
    // 旧明文不可从新密文解出
    assert.notEqual(new IntegrationTokenCipher().decrypt(row.secretCiphertext), oldPlain)
    assert.equal(new IntegrationTokenCipher().decrypt(row.secretCiphertext), rotated.secret.secret)
    assert.isNotNull(row.lastRotatedAt)
  })

  test('deactivate sets inactive and deactivatedAt, keeps visible', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'sub-deact', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actor,
    )
    const deactivated = await svc.deactivate(created.id, actor)
    assert.equal(deactivated.status, 'inactive')
    assert.isNotNull(deactivated.deactivatedAt)

    const row = await OutgoingWebhookSubscription.findOrFail(created.id)
    assert.equal(row.status, 'inactive')
    assert.isNotNull(row.deactivatedAt)
  })

  test('update enforces event whitelist', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'sub-upd', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actor,
    )
    await assert.rejects(
      () => svc.update(created.id, { eventTypes: ['project.deleted' as never] }, actor),
      OutgoingWebhookEventRejectedError,
    )
  })

  test('update enforces URL validation', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'sub-url', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actor,
    )
    await assert.rejects(
      () => svc.update(created.id, { targetUrl: 'http://insecure.example/hook' }, actor),
      Error,
    )
  })

  test('list isolates by organization', async ({ assert }) => {
    const actorA = await makeActor()
    const actorB = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    await svc.create(
      { name: 'org-a-sub', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actorA,
    )
    await svc.create(
      { name: 'org-b-sub', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actorB,
    )

    const listA = await svc.list(actorA)
    assert.equal(listA.length, 1)
    assert.equal(listA[0].name, 'org-a-sub')
    const listB = await svc.list(actorB)
    assert.equal(listB.length, 1)
    assert.equal(listB[0].name, 'org-b-sub')
  })

  test('cross-organization access throws NotFound', async ({ assert }) => {
    const actorA = await makeActor()
    const actorB = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'org-a-sub', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actorA,
    )
    await assert.rejects(
      () => svc.getOwned(created.id, actorB),
      OutgoingWebhookSubscriptionNotFoundError,
    )
  })

  test('rejects duplicate event types in create', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    await assert.rejects(
      () =>
        svc.create(
          { name: 'dup', targetUrl: VALID_URL, eventTypes: ['task.created', 'task.created'] },
          actor,
        ),
      OutgoingWebhookEventRejectedError,
    )
  })

  test('rejects empty event list in create', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    await assert.rejects(
      () => svc.create({ name: 'empty', targetUrl: VALID_URL, eventTypes: [] }, actor),
      OutgoingWebhookEventRejectedError,
    )
  })

  test('audit metadata excludes plaintext and ciphertext', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const created = await svc.create(
      { name: 'audit-sub', targetUrl: VALID_URL, eventTypes: ['task.created'] },
      actor,
    )
    const logs = await AuditLog.query()
      .where('organization_id', actor.organizationId)
      .where('entity_type', 'outgoing_webhook_subscription')
    assert.isAbove(logs.length, 0)
    const blob = JSON.stringify(logs)
    assert.notInclude(blob, created.secret.secret)
    assert.notInclude(blob, 'secretCiphertext')
    // 审计含低敏字段
    const createLog = logs.find(
      (l) =>
        (l.metadata as Record<string, unknown> | null | undefined)?.event ===
        'OUTGOING_WEBHOOK_SUBSCRIPTION_CREATED',
    )
    assert.isDefined(createLog)
    assert.include(JSON.stringify(createLog?.metadata), 'secretFingerprint')
  })

  test('feature-off disables write operations', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    delete process.env.OUTGOING_WEBHOOKS_ENABLED
    await assert.rejects(
      () =>
        svc.create({ name: 'disabled', targetUrl: VALID_URL, eventTypes: ['task.created'] }, actor),
      OutgoingWebhookFeatureDisabledError,
    )
    process.env.OUTGOING_WEBHOOKS_ENABLED = 'true'
  })

  test('subscription lifecycle methods do not call outbound HTTP', async ({ assert }) => {
    const actor = await makeActor()
    const svc = new OutgoingWebhookSubscriptionService()
    const spyCalls: string[] = []
    const origFetch = (globalThis as any).fetch
    ;(globalThis as any).fetch = (...args: unknown[]) => {
      spyCalls.push(String(args[0]))
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    try {
      const created = await svc.create(
        { name: 'no-delivery', targetUrl: VALID_URL, eventTypes: ['task.created'] },
        actor,
      )
      await svc.update(created.id, { name: 'renamed' }, actor)
      await svc.deactivate(created.id, actor)
      assert.equal(spyCalls.length, 0, '订阅生命周期方法不得发起任何外发 HTTP')
    } finally {
      ;(globalThis as any).fetch = origFetch
    }
  })
})
