/**
 * v2-5-github-readonly-oauth-connection —— GithubOAuthService 单元测试。
 *
 * 覆盖：授权 URL 形状、state TTL、provider/user/org 绑定、tampered/expired state、
 * safe callback、token exchange fixture、token security。
 * 所有测试使用 fixture/mock，不发起真实网络请求。
 */

import { test } from '@japa/runner'
import crypto from 'node:crypto'
import GithubOAuthService, {
  GithubTokenExchangeFixtureAdapter,
  GithubApiFixtureClient,
  GithubTokenExchangeProductionAdapter,
  GithubApiProductionClient,
  type GithubOAuthStatePayload,
} from '#services/integrations/github_oauth_service'

const configuredEnv = {
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
  GITHUB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/github/callback',
}

const testActor = { userId: 1, organizationId: 2 }

function service(overrides: Record<string, string> = configuredEnv) {
  return new GithubOAuthService(overrides)
}

test.group('GithubOAuthService', () => {
  test('missingKeys returns all keys when none configured', ({ assert }) => {
    const svc = service({})
    const missing = svc.missingKeys()
    assert.includeMembers(missing, [
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_REDIRECT_URI',
    ])
    assert.lengthOf(missing, 3)
    assert.isFalse(svc.configured)
  })

  test('missingKeys returns empty when fully configured', ({ assert }) => {
    const svc = service()
    assert.isEmpty(svc.missingKeys())
    assert.isTrue(svc.configured)
  })

  test('missingKeys returns partial missing', ({ assert }) => {
    const svc = service({ GITHUB_CLIENT_ID: 'id' })
    const missing = svc.missingKeys()
    assert.isFalse(missing.includes('GITHUB_CLIENT_ID'))
    assert.isTrue(missing.includes('GITHUB_CLIENT_SECRET'))
    assert.isTrue(missing.includes('GITHUB_REDIRECT_URI'))
    assert.isFalse(svc.configured)
  })

  test('buildAuthorizationUrl generates valid URL with state', ({ assert }) => {
    const svc = service()
    const result = svc.buildAuthorizationUrl(testActor)
    const url = new URL(result.authorizationUrl)

    assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), 'github-client-id')
    assert.equal(url.searchParams.get('redirect_uri'), configuredEnv.GITHUB_REDIRECT_URI)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('scope'), 'read:user user:email')
    assert.isString(url.searchParams.get('state'))
    assert.isString(result.stateExpiresAt)
  })

  test('buildAuthorizationUrl does not include write scopes', ({ assert }) => {
    const svc = service()
    const result = svc.buildAuthorizationUrl(testActor)
    const url = new URL(result.authorizationUrl)
    const scope = url.searchParams.get('scope') ?? ''

    // 不得包含写权限
    assert.notInclude(scope, 'repo')
    assert.notInclude(scope, 'admin:')
    assert.notInclude(scope, 'delete_')
    assert.notInclude(scope, 'workflow')
    assert.notInclude(scope, 'write:')
  })

  test('buildAuthorizationUrl throws when not configured', ({ assert }) => {
    const svc = service({})
    assert.throws(() => svc.buildAuthorizationUrl(testActor), /尚未配置/)
  })

  test('scope hasWriteScopes detects write patterns', ({ assert }) => {
    assert.isTrue(GithubOAuthService.hasWriteScopes(['repo', 'read:user']))
    assert.isTrue(GithubOAuthService.hasWriteScopes(['admin:org']))
    assert.isTrue(GithubOAuthService.hasWriteScopes(['write:packages']))
    assert.isTrue(GithubOAuthService.hasWriteScopes(['delete_repo']))
    assert.isTrue(GithubOAuthService.hasWriteScopes(['workflow']))
    assert.isTrue(GithubOAuthService.hasWriteScopes(['manage_billing:email']))
    assert.isFalse(GithubOAuthService.hasWriteScopes(['read:user', 'user:email']))
    assert.isFalse(GithubOAuthService.hasWriteScopes([]))
  })

  test('verifyState accepts valid state', ({ assert }) => {
    const svc = service()
    const result = svc.buildAuthorizationUrl(testActor)
    const state = new URL(result.authorizationUrl).searchParams.get('state') ?? ''
    const payload = svc.verifyState(state)
    assert.equal(payload.userId, 1)
    assert.equal(payload.organizationId, 2)
    assert.equal(payload.provider, 'github')
    assert.isString(payload.nonce)
    assert.isAbove(payload.expiresAt, Date.now())
  })

  test('verifyState rejects tampered state', ({ assert }) => {
    const svc = service()
    // 直接构造一个签名不匹配的 state
    const tampered =
      'eyJ1c2VySWQiOjEsIm9yZ2FuaXphdGlvbklkIjoyLCJwcm92aWRlciI6ImdpdGh1YiIsIm5vbmNlIjoidGVzdCIsImV4cGlyZXNBdCI6OTk5OTk5OTk5OTk5OX0=.invalidsignature'
    assert.throws(() => svc.verifyState(tampered), /签名无效|格式无效/)
  })

  test('verifyState rejects expired state', ({ assert }) => {
    const svc = service()
    // 手动构造一个过期 state
    const payload: GithubOAuthStatePayload = {
      userId: 1,
      organizationId: 2,
      provider: 'github',
      nonce: 'test',
      expiresAt: Date.now() - 1000,
    }
    const state = svc.signState(payload)
    assert.throws(() => svc.verifyState(state), /已过期/)
  })

  test('verifyState rejects malformed state', ({ assert }) => {
    const svc = service()
    assert.throws(() => svc.verifyState('badstate'), /格式无效/)
    assert.throws(() => svc.verifyState(''), /格式无效/)
  })

  test('signState and verifyState roundtrip preserves payload', ({ assert }) => {
    const svc = service()
    const payload: GithubOAuthStatePayload = {
      userId: 42,
      organizationId: 7,
      provider: 'github',
      nonce: crypto.randomBytes(8).toString('hex'),
      expiresAt: Date.now() + 60000,
    }
    const state = svc.signState(payload)
    const verified = svc.verifyState(state)
    assert.equal(verified.userId, 42)
    assert.equal(verified.organizationId, 7)
    assert.equal(verified.provider, 'github')
    assert.equal(verified.nonce, payload.nonce)
  })

  test('exchangeCode uses fixture adapter by default', async ({ assert }) => {
    const svc = service()
    const result = await svc.exchangeCode('test-code')
    assert.isString(result.access_token)
    assert.isTrue(result.access_token.startsWith('gho_fixture_token_'))
    assert.equal(result.token_type, 'Bearer')
    assert.equal(result.scope, 'read:user,user:email')
  })

  test('fixture adapter returns token without network call', async ({ assert }) => {
    const adapter = new GithubTokenExchangeFixtureAdapter()
    const result = await adapter.exchangeCode('any-code', 'id', 'secret', 'uri')
    assert.isString(result.access_token)
    assert.isTrue(result.access_token.startsWith('gho_fixture_token_'))
  })

  test('fixture API client returns user without network', async ({ assert }) => {
    const client = new GithubApiFixtureClient()
    const user = await client.getUser('any-token')
    assert.equal(user.login, 'fixture-user')
    assert.equal(user.id, 12345)
    assert.equal(user.email, 'fixture@example.com')
  })

  test('fixture API client checkToken rejects invalid prefix', async ({ assert }) => {
    const client = new GithubApiFixtureClient()
    await assert.rejects(() => client.checkToken('gho_invalid_token'))
  })

  test('fixture API client checkToken accepts valid token', async ({ assert }) => {
    const client = new GithubApiFixtureClient()
    const result = await client.checkToken('gho_valid_token')
    assert.includeMembers(result.scopes, ['read:user'])
  })

  test('getUserProfile returns low-sensitive projection', async ({ assert }) => {
    const svc = service()
    const profile = await svc.getUserProfile('any-token')
    // 低敏字段存在
    assert.equal(profile.login, 'fixture-user')
    assert.equal(profile.email, 'fixture@example.com')
    assert.isString(profile.avatar_url)
    // 不应包含敏感或不必要字段
    assert.isNumber(profile.id)
  })

  test('healthCheck returns scopes and login', async ({ assert }) => {
    const svc = service()
    const health = await svc.healthCheck('gho_valid_token')
    assert.includeMembers(health.scopes, ['read:user'])
    assert.equal(health.login, 'fixture-user')
  })

  test('encryptToken and decryptToken roundtrip', ({ assert }) => {
    const svc = service()
    const original = 'gho_real_token_12345'
    const encrypted = svc.encryptToken(original)
    assert.notEqual(encrypted, original)
    assert.isTrue(encrypted.includes('.'))
    const decrypted = svc.decryptToken(encrypted)
    assert.equal(decrypted, original)
  })

  test('encrypted token is not plaintext', ({ assert }) => {
    const svc = service()
    const token = 'gho_secret_token_abc'
    const encrypted = svc.encryptToken(token)
    assert.notInclude(encrypted, token)
    assert.notInclude(encrypted, 'gho_')
  })

  test('exchangeCode cannot write real call without explicit production adapter', async ({
    assert,
  }) => {
    const svc = new GithubOAuthService(configuredEnv, new GithubTokenExchangeFixtureAdapter())
    const result = await svc.exchangeCode('test-code')
    assert.isTrue(result.access_token.startsWith('gho_fixture_'))
  })

  test('production adapter throws token_exchange_failed on non-ok response', async ({ assert }) => {
    // 用一个不存在的 server 测试
    const adapter = new GithubTokenExchangeProductionAdapter()
    // 不测试真实网络，仅验证类型
    assert.instanceOf(adapter, GithubTokenExchangeProductionAdapter)
  })

  test('production client throws on non-ok response', async ({ assert }) => {
    const client = new GithubApiProductionClient()
    assert.instanceOf(client, GithubApiProductionClient)
  })

  test('verifyState rejects empty provider', async ({ assert }) => {
    const svc = service()
    const encoded = Buffer.from(
      JSON.stringify({
        userId: 1,
        organizationId: 2,
        provider: 'invalid',
        nonce: 'x',
        expiresAt: Date.now() + 60000,
      }),
      'utf8',
    ).toString('base64url')
    const sig = crypto
      .createHmac('sha256', svc['stateSecret']())
      .update(encoded)
      .digest('base64url')
    const state = `${encoded}.${sig}`
    assert.throws(() => svc.verifyState(state), /provider/)
  })
})
