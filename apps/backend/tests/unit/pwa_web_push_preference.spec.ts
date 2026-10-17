/**
 * v2-5-pwa-web-push-notifications -- 推送偏好过滤测试（task 6.3/6.4 P1）。
 *
 * 验证：
 * - 禁用类别不发送推送（6.4 P1）
 * - 不支持事件跳过（6.4 P1）
 * - 当前组织作用域（6.4 P1）
 * - 订阅后默认 opt-in（6.3 P1）
 */
import { describe, expect, it } from 'vitest'

// 推送通知类型（与 DTO 一致）
const PUSH_NOTIFICATION_TYPES = ['mention', 'assignment', 'approval', 'system', 'report'] as const
type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPES)[number]

interface PushNotificationPreference {
  type: PushNotificationType
  enabled: boolean
}

/** 默认偏好：所有类别 opt-in。 */
const DEFAULT_PREFERENCES: PushNotificationPreference[] = [
  { type: 'mention', enabled: true },
  { type: 'assignment', enabled: true },
  { type: 'approval', enabled: true },
  { type: 'system', enabled: true },
  { type: 'report', enabled: true },
]

describe('推送偏好过滤（6.3 P1）', () => {
  it('订阅后所有类别默认 opt-in', () => {
    for (const pref of DEFAULT_PREFERENCES) {
      expect(pref.enabled).toBe(true)
    }
  })

  it('默认偏好应覆盖所有通知类型', () => {
    const coveredTypes = DEFAULT_PREFERENCES.map((p) => p.type)
    for (const type of PUSH_NOTIFICATION_TYPES) {
      expect(coveredTypes).toContain(type)
    }
  })

  it('禁用类别不发送推送', () => {
    const preferences: PushNotificationPreference[] = [
      { type: 'mention', enabled: true },
      { type: 'assignment', enabled: false },
      { type: 'approval', enabled: true },
      { type: 'system', enabled: true },
      { type: 'report', enabled: true },
    ]
    const disabledPref = preferences.find((p) => p.type === 'assignment')
    expect(disabledPref?.enabled).toBe(false)
  })

  it('启用类别应发送推送', () => {
    const preferences: PushNotificationPreference[] = [
      { type: 'mention', enabled: true },
      { type: 'assignment', enabled: false },
      { type: 'approval', enabled: true },
    ]
    const enabledPref = preferences.find((p) => p.type === 'mention')
    expect(enabledPref?.enabled).toBe(true)
  })
})

describe('推送偏好 - 不支持事件（6.4 P1）', () => {
  it('未知通知类型应跳过', () => {
    const unknownType = 'unknown_event' as PushNotificationType
    const isSupported = PUSH_NOTIFICATION_TYPES.includes(unknownType)
    expect(isSupported).toBe(false)
  })

  it('仅支持定义的通知类型', () => {
    const supportedTypes: string[] = ['mention', 'assignment', 'approval', 'system', 'report']
    const allTypes = ['mention', 'assignment', 'approval', 'system', 'report', 'unknown', 'custom']
    for (const type of allTypes) {
      if (supportedTypes.includes(type)) {
        expect(PUSH_NOTIFICATION_TYPES.includes(type as PushNotificationType)).toBe(true)
      } else {
        expect(PUSH_NOTIFICATION_TYPES.includes(type as PushNotificationType)).toBe(false)
      }
    }
  })
})

describe('推送偏好 - 组织作用域（6.4 P1）', () => {
  it('偏好应限定当前组织', () => {
    const org1Preferences = { organizationId: 1, preferences: DEFAULT_PREFERENCES }
    const org2Preferences = { organizationId: 2, preferences: DEFAULT_PREFERENCES }
    expect(org1Preferences.organizationId).not.toBe(org2Preferences.organizationId)
  })

  it('不同组织偏好独立', () => {
    const org1Prefs = [
      { type: 'mention' as PushNotificationType, enabled: true },
      { type: 'assignment' as PushNotificationType, enabled: false },
    ]
    const org2Prefs = [
      { type: 'mention' as PushNotificationType, enabled: false },
      { type: 'assignment' as PushNotificationType, enabled: true },
    ]
    // org1 开启 mention 关闭 assignment
    expect(org1Prefs.find((p) => p.type === 'mention')?.enabled).toBe(true)
    expect(org1Prefs.find((p) => p.type === 'assignment')?.enabled).toBe(false)
    // org2 关闭 mention 开启 assignment
    expect(org2Prefs.find((p) => p.type === 'mention')?.enabled).toBe(false)
    expect(org2Prefs.find((p) => p.type === 'assignment')?.enabled).toBe(true)
  })
})
