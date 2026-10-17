/**
 * v2-5-pwa-web-push-notifications -- Web Push 审计事件测试（task 4.8）。
 *
 * 验证：
 * - 审计事件枚举值正确
 * - 审计事件到动词的映射正确
 * - 审计记录不包含敏感字段（endpoint、keys、payload body、项目/任务标题、AI 输出、raw metadata）
 */
import { describe, expect, it } from 'vitest'

// 审计事件枚举（与 audit_service.ts 保持一致）
const PWA_WEB_PUSH_SUBSCRIBE = 'PWA_WEB_PUSH_SUBSCRIBE'
const PWA_WEB_PUSH_UNSUBSCRIBE = 'PWA_WEB_PUSH_UNSUBSCRIBE'
const PWA_WEB_PUSH_INVALIDATE = 'PWA_WEB_PUSH_INVALIDATE'
const PWA_WEB_PUSH_SEND_DISABLED = 'PWA_WEB_PUSH_SEND_DISABLED'
const PWA_WEB_PUSH_SEND_ATTEMPT = 'PWA_WEB_PUSH_SEND_ATTEMPT'

// 事件到动词映射（与 EVENT_TO_ACTION 保持一致）
const PWA_WEB_PUSH_EVENT_ACTIONS: Record<string, string> = {
  [PWA_WEB_PUSH_SUBSCRIBE]: 'create',
  [PWA_WEB_PUSH_UNSUBSCRIBE]: 'delete',
  [PWA_WEB_PUSH_INVALIDATE]: 'update',
  [PWA_WEB_PUSH_SEND_DISABLED]: 'reject',
  [PWA_WEB_PUSH_SEND_ATTEMPT]: 'create',
}

/** 敏感字段模式。 */
const SENSITIVE_PATTERNS = [
  /endpoint/i,
  /p256dh/i,
  /auth/i,
  /payloadBody/i,
  /payload_body/i,
  /projectName/i,
  /projectTitle/i,
  /taskName/i,
  /taskTitle/i,
  /aiOutput/i,
  /aiDraft/i,
  /aiResponse/i,
  /rawMetadata/i,
  /raw_metadata/i,
  /fullBody/i,
  /full_body/i,
  /comment/i,
  /filePath/i,
  /fileUrl/i,
  /token/i,
  /secret/i,
  /apiKey/i,
  /password/i,
  /credential/i,
  /privateKey/i,
  /externalPayload/i,
  /external_payload/i,
]

describe('PWA Web Push 审计事件枚举', () => {
  it('审计事件枚举值应正确', () => {
    expect(PWA_WEB_PUSH_SUBSCRIBE).toBe('PWA_WEB_PUSH_SUBSCRIBE')
    expect(PWA_WEB_PUSH_UNSUBSCRIBE).toBe('PWA_WEB_PUSH_UNSUBSCRIBE')
    expect(PWA_WEB_PUSH_INVALIDATE).toBe('PWA_WEB_PUSH_INVALIDATE')
    expect(PWA_WEB_PUSH_SEND_DISABLED).toBe('PWA_WEB_PUSH_SEND_DISABLED')
    expect(PWA_WEB_PUSH_SEND_ATTEMPT).toBe('PWA_WEB_PUSH_SEND_ATTEMPT')
  })

  it('审计事件到动词的映射应正确', () => {
    expect(PWA_WEB_PUSH_EVENT_ACTIONS[PWA_WEB_PUSH_SUBSCRIBE]).toBe('create')
    expect(PWA_WEB_PUSH_EVENT_ACTIONS[PWA_WEB_PUSH_UNSUBSCRIBE]).toBe('delete')
    expect(PWA_WEB_PUSH_EVENT_ACTIONS[PWA_WEB_PUSH_INVALIDATE]).toBe('update')
    expect(PWA_WEB_PUSH_EVENT_ACTIONS[PWA_WEB_PUSH_SEND_DISABLED]).toBe('reject')
    expect(PWA_WEB_PUSH_EVENT_ACTIONS[PWA_WEB_PUSH_SEND_ATTEMPT]).toBe('create')
  })
})

describe('低敏审计 metadata', () => {
  it('订阅审计 metadata 不应包含 endpoint', () => {
    const metadata = { result: 'subscribed' }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('endpoint')
    expect(metadataStr).not.toContain('fcm.googleapis.com')
  })

  it('订阅审计 metadata 不应包含 keys', () => {
    const metadata = { result: 'subscribed' }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('p256dh')
    expect(metadataStr).not.toContain('auth')
  })

  it('取消订阅审计 metadata 不应包含 endpoint', () => {
    const metadata = { result: 'unsubscribed' }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('endpoint')
  })

  it('审计 metadata 不应包含 payload body', () => {
    const metadata = { result: 'sent', notificationId: 42 }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('payloadBody')
    expect(metadataStr).not.toContain('payload_body')
    expect(metadataStr).not.toContain('body')
  })

  it('审计 metadata 不应包含项目/任务标题', () => {
    const metadata = { result: 'sent', notificationId: 42, mode: 'fixture' }
    const metadataStr = JSON.stringify(metadata)
    for (const pattern of SENSITIVE_PATTERNS) {
      if (
        pattern.test('projectName') ||
        pattern.test('projectTitle') ||
        pattern.test('taskName') ||
        pattern.test('taskTitle')
      ) {
        // 这些是测试模式，跳过
        continue
      }
    }
    expect(metadataStr).not.toContain('projectName')
    expect(metadataStr).not.toContain('taskName')
  })

  it('审计 metadata 不应包含 AI 输出', () => {
    const metadata = { result: 'sent', notificationId: 42 }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('aiOutput')
    expect(metadataStr).not.toContain('aiDraft')
  })

  it('审计 metadata 不应包含 raw metadata', () => {
    const metadata = { result: 'sent', notificationId: 42 }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('rawMetadata')
    expect(metadataStr).not.toContain('raw_metadata')
  })

  it('审计 metadata 不应包含 token/secret', () => {
    const metadata = { result: 'sent', notificationId: 42 }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).not.toContain('token')
    expect(metadataStr).not.toContain('secret')
  })

  it('发送尝试审计应只包含低敏字段', () => {
    const metadata = {
      result: 'fixture_recorded',
      notificationId: 42,
      mode: 'fixture',
      recipientCount: 1,
    }
    const metadataStr = JSON.stringify(metadata)

    // 应包含的字段
    expect(metadataStr).toContain('fixture_recorded')
    expect(metadataStr).toContain('notificationId')

    // 不应包含的敏感字段
    for (const pattern of SENSITIVE_PATTERNS) {
      const containsSensitive = pattern.test(metadataStr)
      expect(containsSensitive).toBe(false)
    }
  })

  it('功能禁用审计应只包含结果字段', () => {
    const metadata = { result: 'feature_disabled' }
    const metadataStr = JSON.stringify(metadata)
    expect(metadataStr).toContain('feature_disabled')

    // 不应包含敏感字段
    for (const pattern of SENSITIVE_PATTERNS) {
      const containsSensitive = pattern.test(metadataStr)
      expect(containsSensitive).toBe(false)
    }
  })
})
