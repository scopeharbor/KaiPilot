/**
 * ai-gateway-abstraction —— CryptoService 单元测试。
 * 覆盖:加解密往返、密文格式、maskHint、iv 随机性。
 * 依赖 APP_KEY 或 AI_CONNECTION_ENCRYPTION_KEY(测试环境标配)。
 */
import { test } from '@japa/runner'
import CryptoService from '#services/crypto_service'

test.group('CryptoService', () => {
  test('加解密往返', ({ assert }) => {
    const s = new CryptoService()
    const plain = 'sk-test-12345-abcdef'
    const enc = s.encrypt(plain)
    assert.notEqual(enc, plain)
    assert.equal(s.decrypt(enc), plain)
  })

  test('密文格式 v1 前缀', ({ assert }) => {
    const s = new CryptoService()
    const enc = s.encrypt('x')
    assert.isTrue(enc.startsWith('v1.'))
  })

  test('maskHint 末四位', ({ assert }) => {
    const s = new CryptoService()
    assert.equal(s.maskHint('sk-abcd1234'), '...1234')
    assert.isNull(s.maskHint('ab'))
  })

  test('每次加密 iv 不同 → 密文不同,但解密一致', ({ assert }) => {
    const s = new CryptoService()
    const a = s.encrypt('same-secret')
    const b = s.encrypt('same-secret')
    assert.notEqual(a, b)
    assert.equal(s.decrypt(a), 'same-secret')
    assert.equal(s.decrypt(b), 'same-secret')
  })
})
