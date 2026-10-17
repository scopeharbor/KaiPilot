/**
 * v2-5-outgoing-webhook-delivery-ledger -- 投递账本 Service 集成测试。
 *
 * 直接调用 OutgoingWebhookDeliveryService（注入 FixtureOutgoingWebhookDeliveryClient），
 * 不经 HTTP/RBAC。覆盖数据模型（3.2）、组织隔离（3.4）、enqueue/幂等（4.1-4.4）、
 * 签名边界（5.1）、fixture/no-real-HTTP（5.3/5.4）、feature-off（5.6）、
 * 尝试记录与重试退避（6.1/6.3）、手动重试（7.3）、审计脱敏（7.5/7.6）。
 */
import { test } from '@japa/runner'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'
import OutgoingWebhookSubscriptionService, {
  type SubscriptionActor,
} from '#services/webhooks/outgoing_webhook_subscription_service'
import OutgoingWebhookDeliveryService, {
  OutgoingWebhookDeliveryFeatureDisabledError,
  OutgoingWebhookDeliveryNotFoundError,
  OutgoingWebhookDeliveryNotRetryableError,
  OutgoingWebhookDeliveryPausedError,
} from '#services/webhooks/outgoing_webhook_delivery_service'
import { FixtureOutgoingWebhookDeliveryClient } from '#services/webhooks/outgoing_webhook_delivery_client'
import AuditLog from '#models/audit_log'
import OutgoingWebhookDeliveryEvent from '#models/outgoing_webhook_delivery_event'
import OutgoingWebhookDeliveryAttempt from '#models/outgoing_webhook_delivery_attempt'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import AuditService from '#services/audit_service'
import type { OutgoingWebhookEventType } from '@aiproj/types'

const VALID_URL = 'https://hooks.example.com/incoming'

async function makeActor(): Promise<SubscriptionActor> {
  const user = await createUser()
  const org = await createOrganization(user)
  return { userId: Number(user.id), organizationId: Number(org.id) }
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

function makeService() {
  const client = new FixtureOutgoingWebhookDeliveryClient()
  const service = new OutgoingWebhookDeliveryService(
    new IntegrationTokenCipher(),
    new AuditService(),
    client,
  )
  return { service, client }
}

test.group('Outgoing Webhook Delivery Service', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.OUTGOING_WEBHOOKS_ENABLED = 'true'
    process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    return () => {
      delete process.env.OUTGOING_WEBHOOKS_ENABLED
      delete process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
    }
  })

  test('enqueue matches active subscriptions and creates pending ledger entries (4.1)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created', 'task.updated'])
    await makeSubscription(actor, ['task.created'])
    const { service } = makeService()

    const events = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    assert.equal(events.length, 2)
    for (const e of events) {
      assert.equal(e.status, 'pending')
      assert.equal(e.attemptCount, 0)
      assert.equal(e.eventType, 'task.created')
      assert.isString(e.idempotencyKey)
    }
  })

  test('enqueue skips inactive subscriptions (4.1)', async ({ assert }) => {
    const actor = await makeActor()
    const subSvc = new OutgoingWebhookSubscriptionService()
    const created = await makeSubscription(actor, ['task.created'])
    await subSvc.deactivate(created.id, actor)
    const { service } = makeService()

    const events = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    assert.equal(events.length, 0)
  })

  test('enqueue skips subscriptions whose eventTypes do not match (4.1)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['risk.created'])
    const { service } = makeService()
    const events = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    assert.equal(events.length, 0)
  })

  test('duplicate source event reuses existing ledger entry (4.3 idempotency)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service } = makeService()
    const input = {
      eventType: 'task.created' as const,
      source: { entityType: 'task' as const, entityId: 7, projectId: 1 },
      payload: { taskId: 7, taskTitle: 'T', projectId: 1, createdBy: 5 },
    }
    const first = await service.enqueue(input, actor)
    const second = await service.enqueue(input, actor)
    assert.equal(first.length, 1)
    assert.equal(second.length, 1)
    assert.equal(second[0].id, first[0].id)
    const rows = await OutgoingWebhookDeliveryEvent.all()
    assert.equal(rows.length, 1)
  })

  test('enqueue is organization-isolated (3.4)', async ({ assert }) => {
    const actorA = await makeActor()
    const actorB = await makeActor()
    await makeSubscription(actorA, ['task.created'])
    await makeSubscription(actorB, ['task.created'])
    const { service } = makeService()
    const input = {
      eventType: 'task.created' as const,
      source: { entityType: 'task' as const, entityId: 1, projectId: 1 },
      payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
    }
    const a = await service.enqueue(input, actorA)
    const b = await service.enqueue(input, actorB)
    assert.equal(a.length, 1)
    assert.equal(b.length, 1)
    assert.notEqual(a[0].id, b[0].id)

    // B 看不到 A 的投递
    const listB = await service.list(actorB)
    assert.equal(listB.data.length, 1)
    assert.notEqual(listB.data[0].id, a[0].id)
    await assert.rejects(
      () => service.getDetail(a[0].id, actorB),
      OutgoingWebhookDeliveryNotFoundError,
    )
  })

  test('list preserves inactive/history rows for authorized reads (3.4)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    client.setDefault({
      ok: false,
      status: 500,
      responseBody: 'err',
      failureCategory: 'server_error',
      isRetryable: true,
    })
    // 多次失败耗尽 -> terminal failed
    for (let i = 0; i < ev[0].maxAttempts; i++) {
      const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
      if (event.status === 'failed') break
      await service.executeAttempt(event, actor)
    }
    const list = await service.list(actor)
    assert.equal(list.data.length, 1)
    assert.equal(list.data[0].status, 'failed')
  })

  test('signing boundary: fixture client receives signature headers, secret never persisted (5.1)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    const created = await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)
    assert.equal(client.calls.length, 1)
    const call = client.calls[0]
    assert.equal(call.headers['x-aiproj-webhook-event-type'], 'task.created')
    assert.equal(call.headers['x-aiproj-webhook-delivery-id'], String(ev[0].id))
    assert.isTrue(call.headers['x-aiproj-webhook-signature'].startsWith('v1='))
    assert.isString(call.headers['x-aiproj-webhook-timestamp'])
    assert.equal(call.headers['x-aiproj-webhook-idempotency-key'], event.idempotencyKey)

    // 密钥明文/签名值不入账本或尝试记录
    const eventRow = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    const eventJson = JSON.stringify(eventRow)
    assert.notInclude(eventJson, created.secret.secret)
    const attempts = await OutgoingWebhookDeliveryAttempt.all()
    for (const a of attempts) {
      const j = JSON.stringify(a)
      assert.notInclude(j, created.secret.secret)
      assert.notInclude(j, 'x-aiproj-webhook-signature')
    }
  })

  test('default client is fixture and no real HTTP is performed (5.3/5.4)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    const originalFetch = globalThis.fetch
    let fetchCalled = 0
    globalThis.fetch = (() => {
      fetchCalled++
      return Promise.resolve(new Response('ok', { status: 200 }))
    }) as typeof fetch
    try {
      const ev = await service.enqueue(
        {
          eventType: 'task.created',
          source: { entityType: 'task', entityId: 1, projectId: 1 },
          payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
        },
        actor,
      )
      const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
      await service.executeAttempt(event, actor)
      assert.equal(fetchCalled, 0)
      assert.equal(client.calls.length, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('feature-off disables enqueue/manualRetry but list stays readable (5.6)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service } = makeService()
    // 先在 enabled 时 enqueue 一条
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    delete process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
    try {
      await assert.rejects(
        () =>
          service.enqueue(
            {
              eventType: 'task.created',
              source: { entityType: 'task', entityId: 2, projectId: 1 },
              payload: { taskId: 2, taskTitle: 'T', projectId: 1, createdBy: 5 },
            },
            actor,
          ),
        OutgoingWebhookDeliveryFeatureDisabledError,
      )
      await assert.rejects(
        () => service.manualRetry(ev[0].id, actor),
        OutgoingWebhookDeliveryFeatureDisabledError,
      )
      // list 仍可读
      const list = await service.list(actor)
      assert.equal(list.data.length, 1)
    } finally {
      process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    }
  })

  test('2xx response is terminal success (6.1/6.3)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: true,
      status: 200,
      responseBody: '',
      failureCategory: 'unknown',
      isRetryable: false,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)
    const refreshed = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.equal(refreshed.status, 'success')
    assert.isNull(refreshed.nextAttemptAt)
    const attempts = await OutgoingWebhookDeliveryAttempt.query().where(
      'delivery_event_id',
      ev[0].id,
    )
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0].status, 'success')
    assert.equal(attempts[0].responseStatus, 200)
  })

  test('retryable failure schedules next attempt with backoff (6.3)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: false,
      status: 500,
      responseBody: 'err',
      failureCategory: 'server_error',
      isRetryable: true,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)
    const refreshed = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.equal(refreshed.status, 'pending')
    assert.isNotNull(refreshed.nextAttemptAt)
    assert.equal(refreshed.attemptCount, 1)
    assert.equal(refreshed.failureCategory, 'server_error')
  })

  test('non-retryable 4xx is terminal failure (6.3)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: false,
      status: 404,
      responseBody: 'no',
      failureCategory: 'client_error',
      isRetryable: false,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)
    const refreshed = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.equal(refreshed.status, 'failed')
    assert.isNull(refreshed.nextAttemptAt)
    assert.equal(refreshed.terminalFailureReason, 'client_error')
  })

  test('exhausted attempts become terminal failure (6.3)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: false,
      status: 503,
      responseBody: 'err',
      failureCategory: 'server_error',
      isRetryable: true,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const max = ev[0].maxAttempts
    for (let i = 0; i < max; i++) {
      const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
      if (event.status === 'failed') break
      await service.executeAttempt(event, actor)
    }
    const refreshed = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.equal(refreshed.status, 'failed')
    assert.equal(refreshed.attemptCount, max)
    assert.equal(refreshed.terminalFailureReason, 'exhausted')
    const attempts = await OutgoingWebhookDeliveryAttempt.query().where(
      'delivery_event_id',
      ev[0].id,
    )
    assert.equal(attempts.length, max)
  })

  test('failed attempt records redacted response summary, not full body (6.1)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    const longBody = 'X'.repeat(500)
    client.setDefault({
      ok: false,
      status: 500,
      responseBody: longBody,
      failureCategory: 'server_error',
      isRetryable: true,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)
    const attempt = await OutgoingWebhookDeliveryAttempt.query()
      .where('delivery_event_id', ev[0].id)
      .firstOrFail()
    assert.isNotNull(attempt.responseBodyHash)
    assert.isNotNull(attempt.responseExcerpt)
    // excerpt 被截断，远小于完整 body
    assert.isTrue((attempt.responseExcerpt ?? '').length < longBody.length)
    // 完整 body 不落库
    const j = JSON.stringify(attempt)
    assert.notInclude(j, longBody)
  })

  test('manual retry on eligible failed delivery creates new attempt lineage (7.3)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: false,
      status: 404,
      responseBody: 'no',
      failureCategory: 'client_error',
      isRetryable: false,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    let event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)
    event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.equal(event.status, 'failed')

    client.setDefault({
      ok: true,
      status: 200,
      responseBody: '',
      failureCategory: 'unknown',
      isRetryable: false,
    })
    const result = await service.manualRetry(ev[0].id, actor, { reason: 'operator-retry' })
    assert.equal(result.status, 'success')
    const attempts = await OutgoingWebhookDeliveryAttempt.query().where(
      'delivery_event_id',
      ev[0].id,
    )
    assert.equal(attempts.length, 2) // 旧失败 + 新成功 lineage 保留
  })

  test('manual retry rejects non-failed entries (7.3)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service } = makeService()
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    await assert.rejects(
      () => service.manualRetry(ev[0].id, actor),
      OutgoingWebhookDeliveryNotRetryableError,
    )
  })

  test('manual retry rejects paused delivery (7.3)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service } = makeService()
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    // 先置 failed 再 pause
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    event.status = 'failed'
    event.terminalFailureReason = 'client_error'
    await event.save()
    await service.pauseEvent(ev[0].id, actor)
    await assert.rejects(
      () => service.manualRetry(ev[0].id, actor),
      OutgoingWebhookDeliveryPausedError,
    )
  })

  test('manual retry is cross-organization hidden (7.3)', async ({ assert }) => {
    const actorA = await makeActor()
    const actorB = await makeActor()
    await makeSubscription(actorA, ['task.created'])
    const { service } = makeService()
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actorA,
    )
    await assert.rejects(
      () => service.manualRetry(ev[0].id, actorB),
      OutgoingWebhookDeliveryNotFoundError,
    )
  })

  test('pause prevents send and unpause reschedules (8.3/D6)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    await service.pauseEvent(ev[0].id, actor)
    const paused = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.isTrue(paused.paused)
    await service.executeAttempt(paused, actor)
    assert.equal(client.calls.length, 0) // 暂停不发送

    await service.unpauseEvent(ev[0].id, actor)
    const unpaused = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    assert.isFalse(unpaused.paused)
    assert.equal(unpaused.status, 'pending')
  })

  test('audit events are low-sensitive: no secret/payload body/signature/token (7.5/7.6)', async ({
    assert,
  }) => {
    const actor = await makeActor()
    const created = await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: false,
      status: 500,
      responseBody: 'err',
      failureCategory: 'server_error',
      isRetryable: true,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const event = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event, actor)

    const logs = await AuditLog.query()
      .where('entity_type', 'outgoing_webhook_delivery_event')
      .where('entity_id', ev[0].id)
    assert.isTrue(logs.length >= 2) // enqueue + failed
    const events = logs.map((l) => (l.metadata as Record<string, unknown> | null)?.event)
    assert.include(events, 'OUTGOING_WEBHOOK_DELIVERY_ENQUEUED')
    assert.include(events, 'OUTGOING_WEBHOOK_DELIVERY_FAILED')
    for (const l of logs) {
      const j = JSON.stringify(l)
      assert.notInclude(j, created.secret.secret)
      assert.notInclude(j, 'x-aiproj-webhook-signature')
      assert.notInclude(j, '"payload"') // payload body 不入审计
      const md = (l.metadata as Record<string, unknown> | null) ?? {}
      assert.isDefined(md.subscriptionId)
      assert.isDefined(md.idempotencyKey)
    }
  })

  test('processDue selects due pending events and executes them (6.5/6.6)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: true,
      status: 200,
      responseBody: '',
      failureCategory: 'unknown',
      isRetryable: false,
    })
    await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    const result = await service.processDue()
    assert.equal(result.processed, 1)
    assert.equal(client.calls.length, 1)
    const event = await OutgoingWebhookDeliveryEvent.firstOrFail()
    assert.equal(event.status, 'success')
  })

  test('processDue skips paused and exhausted entries (6.6)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: false,
      status: 404,
      responseBody: 'no',
      failureCategory: 'client_error',
      isRetryable: false,
    })
    const ev = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    // 置 failed（终态）
    const event0 = await OutgoingWebhookDeliveryEvent.findOrFail(ev[0].id)
    await service.executeAttempt(event0, actor)
    // pause 另一条
    const ev2 = await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 2, projectId: 1 },
        payload: { taskId: 2, taskTitle: 'T2', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    await service.pauseEvent(ev2[0].id, actor)
    client.calls.length = 0
    const result = await service.processDue()
    assert.equal(result.processed, 0) // failed 终态 + paused 都跳过
    assert.equal(client.calls.length, 0)
  })

  test('processDue does not duplicate execution per event (6.6)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service, client } = makeService()
    client.setDefault({
      ok: true,
      status: 200,
      responseBody: '',
      failureCategory: 'unknown',
      isRetryable: false,
    })
    await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    await service.processDue()
    // 第二次 processDue：事件已 success，不再执行
    client.calls.length = 0
    const result = await service.processDue()
    assert.equal(result.processed, 0)
    assert.equal(client.calls.length, 0)
    const attempts = await OutgoingWebhookDeliveryAttempt.all()
    assert.equal(attempts.length, 1) // 仅 1 个 attempt，无重复
  })

  test('processDue returns 0 when feature-off (6.6)', async ({ assert }) => {
    const actor = await makeActor()
    await makeSubscription(actor, ['task.created'])
    const { service } = makeService()
    await service.enqueue(
      {
        eventType: 'task.created',
        source: { entityType: 'task', entityId: 1, projectId: 1 },
        payload: { taskId: 1, taskTitle: 'T', projectId: 1, createdBy: 5 },
      },
      actor,
    )
    delete process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED
    try {
      const result = await service.processDue()
      assert.equal(result.processed, 0)
    } finally {
      process.env.OUTGOING_WEBHOOK_DELIVERY_ENABLED = 'true'
    }
  })
})
