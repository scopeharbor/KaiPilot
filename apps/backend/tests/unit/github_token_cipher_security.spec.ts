/**
 * v2-5-github-readonly-oauth-connection —— Token 加密与脱敏安全测试。
 *
 * 覆盖：encrypted token 不包含明文、token 不在日志/审计/DTO 中出现、
 * Authorization header 不暴露。
 */

import { test } from '@japa/runner'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import GithubOAuthService from '#services/integrations/github_oauth_service'
import AuditService from '#services/audit_service'

const configuredEnv = {
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
  GITHUB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/github/callback',
}

test.group('GitHub Token Security', () => {
  test('encrypted token payload does not contain plaintext', ({ assert }) => {
    const cipher = new IntegrationTokenCipher()
    const token = 'gho_secret_token_abc123'
    const encrypted = cipher.encrypt(token)
    assert.notInclude(encrypted, token)
    assert.notInclude(encrypted, 'gho_')
    assert.notInclude(encrypted, 'secret')
  })

  test('encrypted token is not recognizable as GitHub token', ({ assert }) => {
    const cipher = new IntegrationTokenCipher()
    const token = 'gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const encrypted = cipher.encrypt(token)
    // 加密后不应包含 gho_ 前缀
    assert.notInclude(encrypted, 'gho_')
  })

  test('decrypt roundtrip returns original token', ({ assert }) => {
    const cipher = new IntegrationTokenCipher()
    const token = 'gho_test_token_for_roundtrip'
    const encrypted = cipher.encrypt(token)
    const decrypted = cipher.decrypt(encrypted)
    assert.equal(decrypted, token)
  })

  test('decrypt rejects malformed payload', ({ assert }) => {
    const cipher = new IntegrationTokenCipher()
    assert.throws(() => cipher.decrypt('invalid'), /Invalid encrypted token payload/)
    assert.throws(() => cipher.decrypt('a.b'), /Invalid encrypted token payload/)
  })

  test('GithubOAuthService encrypt/decrypt does not leak plaintext', ({ assert }) => {
    const svc = new GithubOAuthService(configuredEnv)
    const token = 'gho_secret_token'
    const encrypted = svc.encryptToken(token)
    assert.notEqual(encrypted, token)
    assert.isFalse(/gho_/.test(encrypted))
    const decrypted = svc.decryptToken(encrypted)
    assert.equal(decrypted, token)
  })

  test('AuditService sanitize removes token fields', ({ assert }) => {
    const sanitized = AuditService.sanitize({
      provider: 'github',
      accessToken: 'gho_super_secret',
      refreshToken: 'ghr_refresh',
      authorization: 'Bearer gho_secret',
      accountLogin: 'fixture-user',
      scopeSummary: 'read:user',
    })
    assert.equal((sanitized as any).accessToken, '***')
    assert.equal((sanitized as any).refreshToken, '***')
    assert.equal((sanitized as any).authorization, '***')
    assert.equal((sanitized as any).accountLogin, 'fixture-user')
    assert.equal((sanitized as any).scopeSummary, 'read:user')
  })

  test('AuditService sanitize respects case-insensitive token fields', ({ assert }) => {
    const sanitized = AuditService.sanitize({
      ACCESS_TOKEN: 'secret',
      Token: 'secret',
      ApiKey: 'secret',
    })
    assert.equal((sanitized as any).ACCESS_TOKEN, '***')
    assert.equal((sanitized as any).Token, '***')
    assert.equal((sanitized as any).ApiKey, '***')
  })

  test('audit metadata for GitHub should not include token or client secret', ({ assert }) => {
    const metadata = AuditService.sanitize({
      provider: 'github',
      accountLogin: 'fixture-user',
      client_secret: 'ghs_secret',
      accessToken: 'gho_token',
      scope: 'read:user',
    })
    assert.equal((metadata as any).accessToken, '***')
    assert.equal((metadata as any).client_secret, '***')
    assert.equal((metadata as any).accountLogin, 'fixture-user')
    assert.equal((metadata as any).scope, 'read:user')
    assert.equal((metadata as any).provider, 'github')
  })
})
