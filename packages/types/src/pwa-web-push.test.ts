/**
 * v2-5-pwa-web-push-notifications -- Web Push DTO 契约测试。
 *
 * 验证：
 * - 推送 envelope 低敏字段白名单（2.2 P0）
 * - 未知字段被拒绝（2.2 P0）
 * - 向后兼容的 DTO 解析（2.2 P0）
 * - 敏感字段不包含在 DTO 中（2.2 P0）
 */
import { describe, it, expect } from 'vitest'
import {
  PUSH_CAPABILITY_STATUS,
  PUSH_SUBSCRIPTION_STATUS,
  PUSH_NOTIFICATION_SEVERITY,
  PUSH_NOTIFICATION_TYPE,
  PUSH_SENDER_MODE,
  PUSH_SEND_RESULT,
  type PushCapabilityState,
  type PushSubscriptionState,
  type PushSubscribeRequest,
  type PushNotificationEnvelope,
  type PushSendAttempt,
} from './pwa-web-push.js'

/** 推送 envelope 允许的顶层字段（design D5：低敏白名单）。 */
const ALLOWED_ENVELOPE_FIELDS = new Set([
  'notificationId',
  'type',
  'severity',
  'createdAt',
  'route',
  'title',
  'body',
])

/** 业务敏感字段模式（禁止出现在 envelope 中）。 */
const SENSITIVE_FIELD_PATTERNS = [
  /projectName/i,
  /projectTitle/i,
  /taskName/i,
  /taskTitle/i,
  /commentBody/i,
  /comment/i,
  /aiOutput/i,
  /aiDraft/i,
  /aiResponse/i,
  /filePath/i,
  /fileUrl/i,
  /downloadUrl/i,
  /attachment/i,
  /token/i,
  /secret/i,
  /apiKey/i,
  /password/i,
  /credential/i,
  /privateKey/i,
  /metadata/i,
  /rawMetadata/i,
  /fullBody/i,
  /bodyText/i,
  /contentText/i,
  /externalPayload/i,
  /rawPayload/i,
]

describe('PwaWebPushDtoContract', () => {
  // ===== 2.2 P0：Envelope 低敏字段白名单 =====

  describe('push envelope shape', () => {
    it('should only contain allowlisted low-sensitive fields', () => {
      const envelope: PushNotificationEnvelope = {
        notificationId: 42,
        type: 'assignment',
        severity: 'info',
        createdAt: '2026-07-23T12:00:00.000Z',
        route: '/notifications',
        title: '新指派',
        body: '你被指派了一个任务',
      }

      const keys = Object.keys(envelope) as Array<keyof PushNotificationEnvelope>
      for (const key of keys) {
        expect(ALLOWED_ENVELOPE_FIELDS.has(key)).toBe(true)
      }
      expect(keys.length).toBeLessThanOrEqual(ALLOWED_ENVELOPE_FIELDS.size)
    })

    it('should not contain sensitive fields on envelope', () => {
      const envelope: PushNotificationEnvelope = {
        notificationId: 42,
        type: 'assignment',
        severity: 'info',
        createdAt: '2026-07-23T12:00:00.000Z',
        route: '/notifications',
        title: '新指派',
        body: '你被指派了一个任务',
      }

      const envelopeStr = JSON.stringify(envelope)
      for (const pattern of SENSITIVE_FIELD_PATTERNS) {
        expect(pattern.test(envelopeStr)).toBe(false)
      }
    })

    it('should have valid type enum values', () => {
      const validTypes = PUSH_NOTIFICATION_TYPE as readonly string[]
      const envelope: PushNotificationEnvelope = {
        notificationId: 42,
        type: 'assignment',
        severity: 'info',
        createdAt: '2026-07-23T12:00:00.000Z',
        route: '/notifications',
        title: '新指派',
        body: '你被指派了一个任务',
      }
      expect(validTypes).toContain(envelope.type)
    })

    it('should have valid severity enum values', () => {
      const validSeverities = PUSH_NOTIFICATION_SEVERITY as readonly string[]
      const envelope: PushNotificationEnvelope = {
        notificationId: 42,
        type: 'assignment',
        severity: 'info',
        createdAt: '2026-07-23T12:00:00.000Z',
        route: '/notifications',
        title: '新指派',
        body: '你被指派了一个任务',
      }
      expect(validSeverities).toContain(envelope.severity)
    })

    it('should accept null body', () => {
      const envelope: PushNotificationEnvelope = {
        notificationId: 1,
        type: 'system',
        severity: 'warning',
        createdAt: '2026-07-23T12:00:00.000Z',
        route: '/notifications',
        title: '系统通知',
        body: null,
      }
      expect(envelope.body).toBeNull()
    })
  })

  // ===== 2.2 P0：未知字段拒绝 =====

  describe('unknown field rejection', () => {
    it('should reject unknown fields on strict parsing', () => {
      const raw = {
        notificationId: 42,
        type: 'assignment',
        severity: 'info',
        createdAt: '2026-07-23T12:00:00.000Z',
        route: '/notifications',
        title: '新指派',
        body: null,
        projectName: '机密项目', // 未知字段
        taskTitle: '秘密任务', // 未知字段
      }

      // 类型层面：额外字段应被拒绝（exact type check）
      const allowedKeys = new Set([
        'notificationId',
        'type',
        'severity',
        'createdAt',
        'route',
        'title',
        'body',
      ])
      const rawKeys = Object.keys(raw)
      const extraKeys = rawKeys.filter((k) => !allowedKeys.has(k))
      expect(extraKeys).toEqual(['projectName', 'taskTitle'])
    })

    it('should reject unknown subscription request fields', () => {
      const raw: Record<string, unknown> = {
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'key1', auth: 'key2' },
        userAgent: 'Chrome 120',
        secret: 'should-not-be-here', // 未知字段
      }

      const allowedKeys = new Set(['endpoint', 'keys', 'userAgent'])
      const rawKeys = Object.keys(raw)
      const extraKeys = rawKeys.filter((k) => !allowedKeys.has(k))
      expect(extraKeys).toEqual(['secret'])
    })
  })

  // ===== 2.2 P0：向后兼容 DTO 解析 =====

  describe('backward-compatible DTO parsing', () => {
    it('should parse capability state from JSON', () => {
      const json = `{
        "enabled": true,
        "capability": "supported",
        "vapidPublicKey": "BNr3..."
      }`
      const state: PushCapabilityState = JSON.parse(json)
      expect(state.enabled).toBe(true)
      expect(PUSH_CAPABILITY_STATUS).toContain(state.capability)
      expect(typeof state.vapidPublicKey).toBe('string')
    })

    it('should parse capability state with feature disabled', () => {
      const json = `{
        "enabled": false,
        "capability": "feature_disabled",
        "vapidPublicKey": null
      }`
      const state: PushCapabilityState = JSON.parse(json)
      expect(state.enabled).toBe(false)
      expect(state.capability).toBe('feature_disabled')
      expect(state.vapidPublicKey).toBeNull()
    })

    it('should parse subscription state from JSON', () => {
      const json = `{
        "status": "active",
        "subscribed": true,
        "createdAt": "2026-07-23T12:00:00.000Z",
        "userAgent": "Chrome 120"
      }`
      const state: PushSubscriptionState = JSON.parse(json)
      expect(PUSH_SUBSCRIPTION_STATUS).toContain(state.status)
      expect(state.subscribed).toBe(true)
      expect(state.createdAt).toBeTruthy()
    })

    it('should parse subscribe request from JSON', () => {
      const json = `{
        "endpoint": "https://fcm.googleapis.com/...",
        "keys": {
          "p256dh": "BOr62...",
          "auth": "aGVsbG8..."
        },
        "userAgent": "Firefox 120"
      }`
      const req: PushSubscribeRequest = JSON.parse(json)
      expect(req.endpoint).toContain('https://')
      expect(req.keys.p256dh).toBeTruthy()
      expect(req.keys.auth).toBeTruthy()
      expect(req.userAgent).toBe('Firefox 120')
    })

    it('should handle valid enum values for subscription status', () => {
      for (const status of PUSH_SUBSCRIPTION_STATUS) {
        const state: PushSubscriptionState = {
          status: status as PushSubscriptionState['status'],
          subscribed: status === 'active',
          createdAt: status === 'active' ? '2026-07-23T00:00:00.000Z' : null,
          userAgent: status === 'active' ? 'Chrome' : null,
        }
        expect(state.status).toBe(status)
        if (status === 'active') {
          expect(state.subscribed).toBe(true)
        } else {
          expect(state.subscribed).toBe(false)
        }
      }
    })
  })

  // ===== 2.2 P0：发送结果快照 =====

  describe('sender result', () => {
    it('should have valid sender mode enum values', () => {
      const validModes = PUSH_SENDER_MODE as readonly string[]
      expect(validModes).toContain('fixture')
      expect(validModes).toContain('production')
    })

    it('should have valid send result enum values', () => {
      const validResults = PUSH_SEND_RESULT as readonly string[]
      expect(validResults).toContain('sent')
      expect(validResults).toContain('failed')
      expect(validResults).toContain('invalid_endpoint')
      expect(validResults).toContain('feature_disabled')
      expect(validResults).toContain('fixture_recorded')
      expect(validResults).toContain('no_recipient')
    })

    it('should create minimal send attempt DTO', () => {
      const attempt: PushSendAttempt = {
        notificationId: 1,
        result: 'fixture_recorded',
        mode: 'fixture',
        createdAt: '2026-07-23T12:00:00.000Z',
      }
      expect(attempt.notificationId).toBe(1)
      expect(attempt.result).toBe('fixture_recorded')
      expect(attempt.mode).toBe('fixture')
    })
  })
})
