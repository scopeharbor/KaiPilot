/**
 * v3-copilot-notification-routing — 六态 fixtures
 *
 * 覆盖：三通道各自投递、组织级禁用、授权门短路、单通道失败。
 * 全部使用确定性数据，零网络 / 零 provider。
 */

import type {
  DeliveryChannel,
  DeliveryChannelPreference,
  DeliveryChannelToggle,
  DeliveryPreference,
  DeliveryPreferenceByKind,
  DeliveryDecisionRecord,
  DeliveryResultSummary,
  ChannelDeliveryResult,
  NotificationPushEnvelope,
  SuppressionReason,
} from './copilot-notification-routing.js'

// ---------------------------------------------------------------------------
// 辅助：确定性 ID 生成
// ---------------------------------------------------------------------------

let _seq = 0

function fixtureId(prefix: string): string {
  _seq++
  return `${prefix}-${String(_seq).padStart(4, '0')}`
}

/** 重置序列（测试间可选调用） */
export function resetDeliveryFixtureSeq(): void {
  _seq = 0
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ORG_ID = 1001
const USER_ID = 2001
const ENTRY_ID = 'entry-fixture-001'
const NOW = '2026-08-18T10:00:00.000Z'

// ---------------------------------------------------------------------------
// 通道偏好工厂
// ---------------------------------------------------------------------------

export function makeChannelPreference(enabled: boolean): DeliveryChannelToggle {
  return { enabled }
}

export function makeAllChannelsEnabled(): DeliveryChannelPreference {
  return {
    badge: makeChannelPreference(true),
    in_app_notification: makeChannelPreference(true),
    push: makeChannelPreference(true),
  }
}

export function makeOnlyBadgeEnabled(): DeliveryChannelPreference {
  return {
    badge: makeChannelPreference(true),
    in_app_notification: makeChannelPreference(false),
    push: makeChannelPreference(false),
  }
}

// ---------------------------------------------------------------------------
// 偏好工厂
// ---------------------------------------------------------------------------

export function makeOrgPreference(
  overrides: Partial<DeliveryPreferenceByKind> = {},
): DeliveryPreference {
  return {
    level: 'organization',
    ownerId: ORG_ID,
    preferences: {
      resource_overload: makeAllChannelsEnabled(),
      schedule_risk: makeAllChannelsEnabled(),
      ...overrides,
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function makePersonalPreference(
  overrides: Partial<DeliveryPreferenceByKind> = {},
): DeliveryPreference {
  return {
    level: 'personal',
    ownerId: USER_ID,
    preferences: {
      resource_overload: makeAllChannelsEnabled(),
      schedule_risk: makeAllChannelsEnabled(),
      ...overrides,
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

// ---------------------------------------------------------------------------
// 决策记录工厂
// ---------------------------------------------------------------------------

export function makeDeliveryDecisionRecord(
  overrides: Partial<DeliveryDecisionRecord> = {},
): DeliveryDecisionRecord {
  return {
    id: fixtureId('decision'),
    entryId: ENTRY_ID,
    organizationId: ORG_ID,
    recipientId: USER_ID,
    channel: 'badge',
    delivered: true,
    suppressionReason: null,
    problemKind: 'resource_overload',
    severity: 'high',
    unreadCount: 3,
    decidedAt: NOW,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 推送信封工厂
// ---------------------------------------------------------------------------

export function makePushEnvelope(
  overrides: Partial<NotificationPushEnvelope> = {},
): NotificationPushEnvelope {
  return {
    entryId: ENTRY_ID,
    problemKind: 'resource_overload',
    severity: 'high',
    unreadCount: 3,
    organizationId: ORG_ID,
    recipientId: USER_ID,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 投递结果工厂
// ---------------------------------------------------------------------------

export function makeChannelResult(
  channel: DeliveryChannel,
  success: boolean,
  reason: SuppressionReason | null = null,
): ChannelDeliveryResult {
  return { channel, success, reason }
}

export function makeDeliverySummary(
  entryId: string,
  results: ChannelDeliveryResult[],
  decisions: DeliveryDecisionRecord[] = [],
): DeliveryResultSummary {
  return { entryId, results, decisions }
}

// ---------------------------------------------------------------------------
// 六态 fixture
// ---------------------------------------------------------------------------

/** 态 1：三通道各自投递 —— badge / in_app_notification / push 均成功 */
export function fixtureThreeChannelDelivery(): DeliveryResultSummary {
  return makeDeliverySummary(
    ENTRY_ID,
    [
      makeChannelResult('badge', true),
      makeChannelResult('in_app_notification', true),
      makeChannelResult('push', true),
    ],
    [
      makeDeliveryDecisionRecord({ channel: 'badge', delivered: true }),
      makeDeliveryDecisionRecord({ channel: 'in_app_notification', delivered: true }),
      makeDeliveryDecisionRecord({ channel: 'push', delivered: true }),
    ],
  )
}

/** 态 2：组织级禁用 —— push 通道被组织关闭，个人无法反向开启 */
export function fixtureOrgDisabledPush(): {
  orgPref: DeliveryPreference
  personalPref: DeliveryPreference
  expectedDisabled: DeliveryChannel[]
} {
  return {
    orgPref: makeOrgPreference({
      resource_overload: {
        badge: makeChannelPreference(true),
        in_app_notification: makeChannelPreference(true),
        push: makeChannelPreference(false),
      },
    }),
    personalPref: makePersonalPreference({
      resource_overload: {
        badge: makeChannelPreference(true),
        in_app_notification: makeChannelPreference(true),
        push: makeChannelPreference(true), // 尝试反向开启
      },
    }),
    expectedDisabled: ['push'],
  }
}

/** 态 3：授权门短路 —— push 通道因授权未开而记录 authorization-gated */
export function fixtureAuthorizationGated(): DeliveryResultSummary {
  return makeDeliverySummary(
    ENTRY_ID,
    [
      makeChannelResult('badge', true),
      makeChannelResult('in_app_notification', true),
      makeChannelResult('push', false, 'authorization_gated'),
    ],
    [
      makeDeliveryDecisionRecord({ channel: 'badge', delivered: true }),
      makeDeliveryDecisionRecord({ channel: 'in_app_notification', delivered: true }),
      makeDeliveryDecisionRecord({
        channel: 'push',
        delivered: false,
        suppressionReason: 'authorization_gated',
      }),
    ],
  )
}

/** 态 4：单通道失败 —— push 发送失败，badge 和 in_app_notification 仍投递 */
export function fixtureSingleChannelFailure(): DeliveryResultSummary {
  return makeDeliverySummary(
    ENTRY_ID,
    [
      makeChannelResult('badge', true),
      makeChannelResult('in_app_notification', true),
      makeChannelResult('push', false, 'channel_failed'),
    ],
    [
      makeDeliveryDecisionRecord({ channel: 'badge', delivered: true }),
      makeDeliveryDecisionRecord({ channel: 'in_app_notification', delivered: true }),
      makeDeliveryDecisionRecord({
        channel: 'push',
        delivered: false,
        suppressionReason: 'channel_failed',
      }),
    ],
  )
}

/** 态 5：逆序组合被拒绝 —— push 开启但通知中心关闭 */
export function fixtureInvertedCombination(): {
  preferences: DeliveryChannelPreference
  expectedError: string
} {
  return {
    preferences: {
      badge: makeChannelPreference(true),
      in_app_notification: makeChannelPreference(false),
      push: makeChannelPreference(true),
    },
    expectedError: '推送通道开启时，站内通知中心必须同时开启',
  }
}

/** 态 6：个人不能反向打开组织已关闭的通道 */
export function fixturePersonalCannotReopen(): {
  orgPref: DeliveryPreferenceByKind
  personalPref: DeliveryPreferenceByKind
  expectedError: string
} {
  return {
    orgPref: {
      resource_overload: {
        badge: makeChannelPreference(true),
        in_app_notification: makeChannelPreference(false),
        push: makeChannelPreference(false),
      },
    },
    personalPref: {
      resource_overload: {
        badge: makeChannelPreference(true),
        in_app_notification: makeChannelPreference(true), // 尝试反向开启
        push: makeChannelPreference(false),
      },
    },
    expectedError:
      '组织已关闭「in_app_notification」通道（问题种类：resource_overload），个人无法反向开启',
  }
}

// ---------------------------------------------------------------------------
// 确定性路由测试数据
// ---------------------------------------------------------------------------

/** 不同键序独立构造，验证路由确定性 */
export function fixtureDeterministicRouting(): {
  entry: { entryId: string; problemKind: string; severity: string }
  prefA: DeliveryChannelPreference
  prefB: DeliveryChannelPreference
} {
  return {
    entry: {
      entryId: 'entry-det-001',
      problemKind: 'resource_overload',
      severity: 'critical',
    },
    // 键序 1
    prefA: {
      badge: makeChannelPreference(true),
      push: makeChannelPreference(true),
      in_app_notification: makeChannelPreference(true),
    },
    // 键序 2（不同顺序）
    prefB: {
      push: makeChannelPreference(true),
      badge: makeChannelPreference(true),
      in_app_notification: makeChannelPreference(true),
    },
  }
}

/** 预期投递通道顺序：badge → in_app_notification → push（按强度序） */
export const EXPECTED_DELIVERY_CHANNEL_ORDER: DeliveryChannel[] = [
  'badge',
  'in_app_notification',
  'push',
]
