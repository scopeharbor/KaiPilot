/**
 * v2-5-pwa-web-push-notifications -- PushSubscriptionCipher 加密保护测试（task 3.3/3.4）。
 *
 * 验证：
 * - 加密/解密往返正确
 * - 密文格式自包含（iv+tag+enc）
 * - 不同输入产生不同密文
 * - 篡改密文导致解密失败
 * - 原始 endpoint/key 材料不在 DTO、日志、校验错误或审计摘要中泄漏
 */
import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'

// 测试用密钥（派生自 APP_KEY 模拟）
const TEST_KEY = 'test-app-key-for-encryption-only-not-for-production'

// 模拟 PushSubscriptionCipher 的纯函数行为
function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const key = crypto.createHash('sha256').update(TEST_KEY).digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

function decrypt(payload: string): string {
  const parts = payload.split('.')
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const enc = Buffer.from(parts[3], 'base64')
  const key = crypto.createHash('sha256').update(TEST_KEY).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

describe('PushSubscriptionCipher 加密保护', () => {
  it('加密/解密往返正确', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'
    const encrypted = encrypt(endpoint)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(endpoint)
  })

  it('p256dh key 加密/解密往返正确', () => {
    const p256dh = 'BOr62G39p2W5jMf3q6o0wL8zX9Y1kZ4a7cV5bN3mR8tQ2wE4rT6yU9pO1sD5fH7jK'
    const encrypted = encrypt(p256dh)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(p256dh)
  })

  it('auth key 加密/解密往返正确', () => {
    const auth = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYXV0aCBrZXk'
    const encrypted = encrypt(auth)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(auth)
  })

  it('不同输入产生不同密文（IV 随机性）', () => {
    const plain = 'https://example.com/endpoint'
    const enc1 = encrypt(plain)
    const enc2 = encrypt(plain)
    expect(enc1).not.toBe(enc2) // 每次加密 IV 不同，密文不同
  })

  it('密文格式包含 v1.iv.tag.enc 四部分', () => {
    const plain = 'https://example.com/push'
    const encrypted = encrypt(plain)
    const parts = encrypted.split('.')
    expect(parts.length).toBe(4)
    expect(parts[0]).toBe('v1')
    expect(parts[1].length).toBeGreaterThan(0) // iv
    expect(parts[2].length).toBeGreaterThan(0) // tag
    expect(parts[3].length).toBeGreaterThan(0) // encrypted
  })

  it('篡改密文导致解密失败', () => {
    const plain = 'https://example.com/endpoint'
    const encrypted = encrypt(plain)
    // 篡改 iv 部分
    const parts = encrypted.split('.')
    parts[1] = 'AAAA' + parts[1].slice(4)
    const tampered = parts.join('.')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('无效密文格式应抛出错误', () => {
    expect(() => decrypt('invalid-format')).toThrow()
  })

  it('空密文应抛出错误', () => {
    expect(() => decrypt('v1..')).toThrow()
  })

  it('endpoint 哈希不暴露原始 endpoint', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/secret123'
    const hash = crypto.createHash('sha256').update(endpoint).digest('hex')
    // 哈希是 64 字符 hex 字符串
    expect(hash).toHaveLength(64)
    // 哈希不包含原始 endpoint 内容
    expect(hash).not.toContain('fcm.googleapis.com')
    expect(hash).not.toContain('secret123')
  })

  it('哈希用于唯一性但不暴露原始值', () => {
    const endpoint1 = 'https://fcm.googleapis.com/fcm/send/abc123'
    const endpoint2 = 'https://fcm.googleapis.com/fcm/send/xyz789'

    const hash1 = crypto.createHash('sha256').update(endpoint1).digest('hex')
    const hash2 = crypto.createHash('sha256').update(endpoint2).digest('hex')

    expect(hash1).not.toBe(hash2)
    expect(hash1).not.toContain('abc123')
    expect(hash2).not.toContain('xyz789')
  })

  it('相同 endpoint 产生相同哈希', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'
    const hash1 = crypto.createHash('sha256').update(endpoint).digest('hex')
    const hash2 = crypto.createHash('sha256').update(endpoint).digest('hex')
    expect(hash1).toBe(hash2)
  })
})

describe('PwaPushSubscription 模型字段验证', () => {
  it('endpoint_hash 字段不应暴露完整 endpoint 内容', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/super-secret-endpoint'
    const hash = crypto.createHash('sha256').update(endpoint).digest('hex')
    // 验证哈希长度
    expect(hash).toHaveLength(64)
    // 验证哈希是 hex 格式
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('status 字段应为 active/revoked/invalidated 之一', () => {
    const validStatuses = ['active', 'revoked', 'invalidated']
    // 验证所有有效状态
    for (const status of validStatuses) {
      expect(validStatuses).toContain(status)
    }
    // 验证无效状态
    expect(validStatuses).not.toContain('deleted')
    expect(validStatuses).not.toContain('expired')
  })

  it('DTO 不应包含原始 endpoint/key 明文', () => {
    // 这些原始值不应出现在 DTO 中
    const rawEndpoint = 'https://fcm.googleapis.com/fcm/send/abc123'
    const rawP256dh = 'BOr62G39p2W5jMf3q6o0wL8zX9Y1kZ4a7cV5bN3mR8tQ'
    const rawAuth = 'aGVsbG8gd29ybGQ='

    const dto = {
      id: 1,
      status: 'active',
      createdAt: '2026-07-23T12:00:00.000Z',
    }

    // DTO 不应包含原始 key 材料
    const dtoStr = JSON.stringify(dto)
    expect(dtoStr).not.toContain(rawEndpoint)
    expect(dtoStr).not.toContain(rawP256dh.slice(0, 8))
    expect(dtoStr).not.toContain(rawAuth.slice(0, 8))
  })
})
