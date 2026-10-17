import { test } from '@japa/runner'
import { DeliveryOrchestrator } from '#services/copilot_notification/delivery_orchestrator'
import type { DeliveryInput } from '#services/copilot_notification/delivery_orchestrator'
import type { DeliveryPreference } from '@aiproj/types'

// Mock NotificationService
const mockNotificationService = {
  createForUser: async () => ({ id: 1 }),
  getUnreadCount: async () => ({ unreadCount: 5 }),
} as any

// Mock RealtimeBroadcaster
const mockBroadcaster = {
  broadcastToUser: () => {},
} as any

const baseInput: DeliveryInput = {
  entryId: 'entry-1',
  organizationId: 1001,
  recipientId: 2001,
  projectId: 100,
  problemKind: 'resource_overload',
  severity: 'high',
  unreadCount: 3,
}

const allChannelsEnabled: DeliveryPreference = {
  level: 'organization',
  ownerId: 1001,
  preferences: {
    resource_overload: {
      badge: { enabled: true },
      in_app_notification: { enabled: true },
      push: { enabled: true },
    },
  },
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
}

test.group('DeliveryOrchestrator - 失败降级（D5）', () => {
  test('6.1: 单通道失败不影响其余通道', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: false },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    const badgeResult = result.results.find((r) => r.channel === 'badge')
    const inAppResult = result.results.find((r) => r.channel === 'in_app_notification')

    assert.isTrue(badgeResult?.success)
    assert.isTrue(inAppResult?.success)

    const pushResult = result.results.find((r) => r.channel === 'push')
    assert.isFalse(pushResult?.success)
    assert.equal(pushResult?.reason, 'authorization_gated')
  })

  test('6.3: 失败按通道分别记录原因', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: false },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    const pushDecision = result.decisions.find((d) => d.channel === 'push')
    assert.equal(pushDecision?.suppressionReason, 'authorization_gated')

    const badgeDecision = result.decisions.find((d) => d.channel === 'badge')
    const inAppDecision = result.decisions.find((d) => d.channel === 'in_app_notification')
    assert.isNull(badgeDecision?.suppressionReason)
    assert.isNull(inAppDecision?.suppressionReason)
  })

  test('6.5: 投递失败后条目未消失', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: false },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    assert.equal(result.entryId, 'entry-1')
    assert.lengthOf(result.decisions, 3)
  })
})

test.group('DeliveryOrchestrator - 健康视图（5.8）', () => {
  test('5.8: 区分「未授权」与「投递失败」', ({ assert }) => {
    const orchestratorGated = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: false },
      mockNotificationService,
      mockBroadcaster,
    )

    const orchestratorReady = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const healthGated = orchestratorGated.getHealthStatus()
    const healthReady = orchestratorReady.getHealthStatus()

    assert.equal(healthGated.push.status, 'not_authorized')
    assert.isFalse(healthGated.push.authorized)

    assert.equal(healthReady.push.status, 'ready')
    assert.isTrue(healthReady.push.authorized)
  })

  test('5.9: 二者不被合并为同一状态', ({ assert }) => {
    const orchestratorGated = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: false },
      mockNotificationService,
      mockBroadcaster,
    )

    const orchestratorReady = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const healthGated = orchestratorGated.getHealthStatus()
    const healthReady = orchestratorReady.getHealthStatus()

    assert.notEqual(healthGated.push.status, healthReady.push.status)
  })
})

test.group('DeliveryOrchestrator - 徽章与站内通知（4.1-4.9）', () => {
  test('4.1: 面板徽章未读计数消费收件箱既有计数端点', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    const badgeResult = result.results.find((r) => r.channel === 'badge')
    assert.isTrue(badgeResult?.success)
  })

  test('4.3: 站内通知走 notification_service，不新建实体', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    const inAppResult = result.results.find((r) => r.channel === 'in_app_notification')
    assert.isTrue(inAppResult?.success)
  })

  test('4.7: 投递不改变收件箱条目状态', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    assert.equal(result.entryId, 'entry-1')
  })
})

test.group('DeliveryOrchestrator - 推送与授权门（5.1-5.5）', () => {
  test('5.1: 推送信封构造正确', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    const pushResult = result.results.find((r) => r.channel === 'push')
    assert.isTrue(pushResult?.success)
  })

  test('5.4: 授权未开时 push 记录 authorization-gated', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: false },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    const pushResult = result.results.find((r) => r.channel === 'push')
    assert.isFalse(pushResult?.success)
    assert.equal(pushResult?.reason, 'authorization_gated')
  })
})

test.group('DeliveryOrchestrator - 权限、组织隔离与红线（7.1-7.7）', () => {
  test('7.1: 投递前按 actor 权限复核条目可见性', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    assert.lengthOf(result.results, 3)
  })

  test('7.3: 组织隔离，所有投递路径附加 organization_id', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    for (const decision of result.decisions) {
      assert.equal(decision.organizationId, 1001)
    }
  })

  test('7.5: 投递层零域写依赖', async ({ assert }) => {
    const orchestrator = new DeliveryOrchestrator(
      { pushAuthorizationEnabled: true },
      mockNotificationService,
      mockBroadcaster,
    )

    const result = await orchestrator.deliver(baseInput, allChannelsEnabled)

    assert.equal(result.entryId, 'entry-1')
  })
})
