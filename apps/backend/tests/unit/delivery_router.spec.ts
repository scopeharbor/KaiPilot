import { test } from '@japa/runner'
import { DeliveryRouter } from '#services/copilot_notification/delivery_router'
import type { DeliveryPreference, DeliveryChannelPreference } from '@aiproj/types'

// 辅助：创建通道偏好
function makePref(badge: boolean, inApp: boolean, push: boolean): DeliveryChannelPreference {
  return {
    badge: { enabled: badge },
    in_app_notification: { enabled: inApp },
    push: { enabled: push },
  }
}

// 辅助：创建组织偏好
function makeOrgPref(pref: DeliveryChannelPreference): DeliveryPreference {
  return {
    level: 'organization',
    ownerId: 1001,
    preferences: { resource_overload: pref },
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
  }
}

// 辅助：创建个人偏好
function makePersonalPref(pref: DeliveryChannelPreference): DeliveryPreference {
  return {
    level: 'personal',
    ownerId: 2001,
    preferences: { resource_overload: pref },
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
  }
}

test.group('DeliveryRouter - 通道包含关系（D1）', () => {
  test('3.4: 相同输入产出相同通道集合（确定性）', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result1 = router.route('entry-1', 'resource_overload', orgPref)
    const result2 = router.route('entry-1', 'resource_overload', orgPref)

    assert.deepEqual(
      result1.results.map((r) => r.channel),
      result2.results.map((r) => r.channel),
    )
    assert.deepEqual(
      result1.results.map((r) => r.success),
      result2.results.map((r) => r.success),
    )
  })

  test('3.5: 不同键序独立构造求值两次全等', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })

    const prefA: DeliveryPreference = {
      level: 'organization',
      ownerId: 1001,
      preferences: {
        resource_overload: {
          badge: { enabled: true },
          push: { enabled: true },
          in_app_notification: { enabled: true },
        },
      },
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    }

    const prefB: DeliveryPreference = {
      level: 'organization',
      ownerId: 1001,
      preferences: {
        resource_overload: {
          push: { enabled: true },
          badge: { enabled: true },
          in_app_notification: { enabled: true },
        },
      },
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    }

    const result1 = router.route('entry-1', 'resource_overload', prefA)
    const result2 = router.route('entry-1', 'resource_overload', prefB)

    assert.deepEqual(result1.results, result2.results)
  })
})

test.group('DeliveryRouter - 组织级偏好为上限（D7）', () => {
  test('3.2: 个人级不能反向打开组织已关闭的通道', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })

    const orgPref = makeOrgPref(makePref(true, true, false))
    const personalPref = makePersonalPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref, personalPref)

    const pushResult = result.results.find((r) => r.channel === 'push')
    assert.isFalse(pushResult?.success)
    assert.equal(pushResult?.reason, 'organization_disabled')
  })

  test('3.2: 个人级可以在组织允许范围内更严格', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })

    const orgPref = makeOrgPref(makePref(true, true, true))
    const personalPref = makePersonalPref(makePref(true, false, false))

    const result = router.route('entry-1', 'resource_overload', orgPref, personalPref)

    const badgeResult = result.results.find((r) => r.channel === 'badge')
    const inAppResult = result.results.find((r) => r.channel === 'in_app_notification')
    const pushResult = result.results.find((r) => r.channel === 'push')

    assert.isTrue(badgeResult?.success)
    assert.isFalse(inAppResult?.success)
    assert.isFalse(pushResult?.success)
    assert.equal(inAppResult?.reason, 'channel_disabled')
    assert.equal(pushResult?.reason, 'channel_disabled')
  })
})

test.group('DeliveryRouter - 授权门（D4）', () => {
  test('5.4: 授权未开时 push 记录 authorization-gated', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: false })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref)

    const pushResult = result.results.find((r) => r.channel === 'push')
    assert.isFalse(pushResult?.success)
    assert.equal(pushResult?.reason, 'authorization_gated')
  })

  test('5.5: 授权门未开时 badge 和 in_app_notification 仍投递', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: false })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref)

    const badgeResult = result.results.find((r) => r.channel === 'badge')
    const inAppResult = result.results.find((r) => r.channel === 'in_app_notification')

    assert.isTrue(badgeResult?.success)
    assert.isTrue(inAppResult?.success)
  })
})

test.group('DeliveryRouter - 失败降级（D5）', () => {
  test('6.1: 单通道失败不影响其余通道', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref)

    assert.lengthOf(result.results, 3)
    assert.lengthOf(result.decisions, 3)
  })

  test('6.3: 失败按通道分别记录原因', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: false })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref)

    const pushDecision = result.decisions.find((d) => d.channel === 'push')
    assert.equal(pushDecision?.suppressionReason, 'authorization_gated')

    const badgeDecision = result.decisions.find((d) => d.channel === 'badge')
    const inAppDecision = result.decisions.find((d) => d.channel === 'in_app_notification')
    assert.isNull(badgeDecision?.suppressionReason)
    assert.isNull(inAppDecision?.suppressionReason)
  })
})

test.group('DeliveryRouter - 无频次判定（D2）', () => {
  test('3.6: 投递层无频次窗口与限流依赖', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result1 = router.route('entry-1', 'resource_overload', orgPref)
    const result2 = router.route('entry-1', 'resource_overload', orgPref)

    assert.lengthOf(result1.results, 3)
    assert.lengthOf(result2.results, 3)
  })
})

test.group('DeliveryRouter - 决策记录（3.8）', () => {
  test('每次路由都产出决策记录', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: true })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref)

    assert.lengthOf(result.decisions, 3)
    for (const decision of result.decisions) {
      assert.equal(decision.entryId, 'entry-1')
      assert.isString(decision.id)
      assert.isString(decision.decidedAt)
    }
  })

  test('未投递的通道有抑制原因', ({ assert }) => {
    const router = new DeliveryRouter({ pushAuthorizationEnabled: false })
    const orgPref = makeOrgPref(makePref(true, true, true))

    const result = router.route('entry-1', 'resource_overload', orgPref)

    const undeliveredDecisions = result.decisions.filter((d) => !d.delivered)
    for (const decision of undeliveredDecisions) {
      assert.isNotNull(decision.suppressionReason)
    }
  })
})
