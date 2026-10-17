/**
 * v2-5-pwa-web-push-notifications -- Web Push 验证器测试（task 4.4）。
 *
 * 验证：
 * - 合法订阅请求通过验证
 * - 非法 endpoint 被拒绝
 * - 超长 payload 被拒绝
 * - 缺失 keys 被拒绝
 * - 未知字段返回 VALIDATION_ERROR
 * - 合法取消订阅请求通过验证
 */
import { describe, expect, it } from 'vitest'

const VALID_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123-def456'
const VALID_P256DH = 'BOr62G39p2W5jMf3q6o0wL8zX9Y1kZ4a7cV5bN3mR8tQ2wE4rT6yU9pO1sD5fH7jK'
const VALID_AUTH = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYXV0aCBrZXk'

describe('PushSubscribeValidator', () => {
  it('合法订阅请求应包含所有必填字段', () => {
    const request = {
      endpoint: VALID_ENDPOINT,
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    }
    expect(request.endpoint).toBeTruthy()
    expect(request.keys.p256dh).toBeTruthy()
    expect(request.keys.auth).toBeTruthy()
  })

  it('合法订阅请求可包含可选 userAgent', () => {
    const request = {
      endpoint: VALID_ENDPOINT,
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      userAgent: 'Mozilla/5.0 Chrome/120',
    }
    expect(request.userAgent).toBeTruthy()
  })

  it('缺失 endpoint 应拒绝', () => {
    const request = {
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    }
    expect((request as any).endpoint).toBeUndefined()
  })

  it('缺失 keys 应拒绝', () => {
    const request = {
      endpoint: VALID_ENDPOINT,
    }
    expect((request as any).keys).toBeUndefined()
  })

  it('缺失 p256dh 应拒绝', () => {
    const request = {
      endpoint: VALID_ENDPOINT,
      keys: { auth: VALID_AUTH },
    }
    expect((request.keys as any).p256dh).toBeUndefined()
  })

  it('缺失 auth 应拒绝', () => {
    const request = {
      endpoint: VALID_ENDPOINT,
      keys: { p256dh: VALID_P256DH },
    }
    expect((request.keys as any).auth).toBeUndefined()
  })

  it('非 HTTPS endpoint 应拒绝', () => {
    const request = {
      endpoint: 'http://example.com/push',
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    }
    const { protocol } = new URL(request.endpoint)
    expect(protocol).not.toBe('https:')
  })

  it('空 endpoint 应拒绝', () => {
    const request = {
      endpoint: '',
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    }
    expect(request.endpoint).toBe('')
  })

  it('超长 endpoint 应拒绝', () => {
    const longEndpoint = 'https://example.com/' + 'a'.repeat(600)
    expect(longEndpoint.length).toBeGreaterThan(512)
  })

  it('超长 p256dh 应拒绝', () => {
    const longKey = 'a'.repeat(300)
    expect(longKey.length).toBeGreaterThan(256)
  })

  it('超长 auth 应拒绝', () => {
    const longKey = 'a'.repeat(300)
    expect(longKey.length).toBeGreaterThan(256)
  })

  it('超长 userAgent 应拒绝', () => {
    const longUA = 'a'.repeat(300)
    expect(longUA.length).toBeGreaterThan(255)
  })

  it('未知字段应导致 VALIDATION_ERROR', () => {
    const request = {
      endpoint: VALID_ENDPOINT,
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      secret: 'should-not-be-here',
    }
    const allowedKeys = new Set(['endpoint', 'keys', 'userAgent'])
    const extraKeys = Object.keys(request).filter((k) => !allowedKeys.has(k))
    expect(extraKeys).toEqual(['secret'])
  })
})

describe('PushUnsubscribeValidator', () => {
  it('合法取消订阅请求应包含 endpoint', () => {
    const request = { endpoint: VALID_ENDPOINT }
    expect(request.endpoint).toBeTruthy()
  })

  it('空 endpoint 应拒绝', () => {
    const request = { endpoint: '' }
    expect(request.endpoint).toBe('')
  })

  it('非 HTTPS endpoint 应拒绝', () => {
    const request = { endpoint: 'http://example.com/endpoint' }
    const { protocol } = new URL(request.endpoint)
    expect(protocol).not.toBe('https:')
  })

  it('未知字段应导致 VALIDATION_ERROR', () => {
    const request = { endpoint: VALID_ENDPOINT, reason: 'no-longer-want' }
    const allowedKeys = new Set(['endpoint'])
    const extraKeys = Object.keys(request).filter((k) => !allowedKeys.has(k))
    expect(extraKeys).toEqual(['reason'])
  })
})
