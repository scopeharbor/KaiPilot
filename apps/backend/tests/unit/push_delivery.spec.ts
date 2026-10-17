import { test } from '@japa/runner'
import { PushDelivery } from '#services/copilot_notification/push_delivery'
import type { PushDeliveryInput } from '#services/copilot_notification/push_delivery'

const baseInput: PushDeliveryInput = {
  entryId: 'entry-1',
  organizationId: 1001,
  recipientId: 2001,
  problemKind: 'resource_overload',
  severity: 'high',
  unreadCount: 3,
}

test.group('PushDelivery - 推送信封构造（5.1 + 5.2）', () => {
  test('5.1: 信封包含条目引用、问题种类、严重度、未读计数', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: true })

    const envelope = delivery.buildEnvelope(baseInput)

    assert.equal(envelope.entryId, 'entry-1')
    assert.equal(envelope.problemKind, 'resource_overload')
    assert.equal(envelope.severity, 'high')
    assert.equal(envelope.unreadCount, 3)
    assert.equal(envelope.organizationId, 1001)
    assert.equal(envelope.recipientId, 2001)
  })

  test('5.2: 信封不含建议正文', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: true })

    const envelope = delivery.buildEnvelope(baseInput)

    assert.notProperty(envelope, 'suggestionBody')
    assert.notProperty(envelope, 'suggestionText')
    assert.notProperty(envelope, 'prompt')
    assert.notProperty(envelope, 'modelOutput')
    assert.notProperty(envelope, 'token')
    assert.notProperty(envelope, 'secret')
  })
})

test.group('PushDelivery - 授权门短路（5.4）', () => {
  test('5.4: 授权未开时构造信封但不发送', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: false })

    const { envelope, result, decision } = delivery.deliver(baseInput)

    assert.equal(envelope.entryId, 'entry-1')

    assert.isFalse(result.success)
    assert.equal(result.reason, 'authorization_gated')

    assert.isFalse(decision.delivered)
    assert.equal(decision.suppressionReason, 'authorization_gated')
  })

  test('5.5: 授权门未开时零外部请求', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: false })

    const { result } = delivery.deliver(baseInput)

    assert.equal(result.channel, 'push')
    assert.isFalse(result.success)
    assert.equal(result.reason, 'authorization_gated')
  })

  test('授权开启时投递成功', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: true })

    const { result, decision } = delivery.deliver(baseInput)

    assert.isTrue(result.success)
    assert.isNull(result.reason)
    assert.isTrue(decision.delivered)
    assert.isNull(decision.suppressionReason)
  })
})

test.group('PushDelivery - 健康视图（5.8）', () => {
  test('5.8: 未授权状态与失败状态区分', ({ assert }) => {
    const deliveryGated = new PushDelivery({ pushAuthorizationEnabled: false })
    const deliveryReady = new PushDelivery({ pushAuthorizationEnabled: true })

    const healthGated = deliveryGated.getHealthStatus()
    const healthReady = deliveryReady.getHealthStatus()

    assert.isFalse(healthGated.authorized)
    assert.equal(healthGated.status, 'not_authorized')

    assert.isTrue(healthReady.authorized)
    assert.equal(healthReady.status, 'ready')
  })

  test('5.9: 二者不被合并为同一状态', ({ assert }) => {
    const deliveryGated = new PushDelivery({ pushAuthorizationEnabled: false })
    const deliveryReady = new PushDelivery({ pushAuthorizationEnabled: true })

    const healthGated = deliveryGated.getHealthStatus()
    const healthReady = deliveryReady.getHealthStatus()

    assert.notEqual(healthGated.status, healthReady.status)
  })
})

test.group('PushDelivery - 授权前置条件（5.10）', () => {
  test('5.10: 记录真实外发所需的授权前置条件清单', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: true })

    const prerequisites = delivery.getAuthorizationPrerequisites()

    assert.isArray(prerequisites)
    assert.isAbove(prerequisites.length, 0)
    assert.include(prerequisites, 'VAPID 公私钥对已生成')
    assert.include(prerequisites, 'pushNotificationConfig.sendEnabled 设为 true')
  })
})

test.group('PushDelivery - 失败降级（6.1）', () => {
  test('6.1: push 通道失败不影响其他通道', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: false })

    const { result } = delivery.deliver(baseInput)

    assert.isFalse(result.success)
    assert.equal(result.reason, 'authorization_gated')
  })

  test('6.3: 失败按通道分别记录原因', ({ assert }) => {
    const delivery = new PushDelivery({ pushAuthorizationEnabled: false })

    const { decision } = delivery.deliver(baseInput)

    assert.equal(decision.channel, 'push')
    assert.equal(decision.suppressionReason, 'authorization_gated')
  })
})
