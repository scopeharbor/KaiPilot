/**
 * v2-5-gitlab-readonly-oauth-connection —— GitlabOAuthService 单元测试。
 *
 * 覆盖：授权 URL 形状、state TTL、provider/user/org 绑定、tampered/expired state、
 * safe callback、token exchange fixture、token refresh、token security。
 * 所有测试使用 fixture/mock，不发起真实网络请求。
 */

import { test } from '@japa/runner'
import crypto from 'node:crypto'
import GitlabOAuthService, {
  GitlabTokenExchangeFixtureAdapter,
  GitlabTokenRefreshFixtureAdapter,
  GitlabTokenExchangeProductionAdapter,
  GitlabTokenRefreshProductionAdapter,
  GitlabApiFixtureClient,
  GitlabApiProductionClient,
  type GitlabOAuthStatePayload,
} from '#services/integrations/gitlab_oauth_service'
import IntegrationConnection from '#models/integration_connection'

const configuredEnv = {
  GITLAB_CLIENT_ID: 'gitlab-client-id',
  GITLAB_CLIENT_SECRET: 'gitlab-client-secret',
  GITLAB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/gitlab/callback',
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}

const testActor = { userId: 1, organizationId: 2 }

function service(overrides: Record<string, string | undefined> = configuredEnv) {
  return new GitlabOAuthService(overrides)
}

test.group('GitlabOAuthService', () => {
  // -----------------------------------------------------------------------
  // Config state
  // -----------------------------------------------------------------------

  test('missingKeys returns all keys when none configured', ({ assert }) => {
    const svc = service({})
    const missing = svc.missingKeys()
    assert.includeMembers(missing, [
      'GITLAB_CLIENT_ID',
      'GITLAB_CLIENT_SECRET',
      'GITLAB_REDIRECT_URI',
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
    const svc = service({ GITLAB_CLIENT_ID: 'id' })
    const missing = svc.missingKeys()
    assert.isFalse(missing.includes('GITLAB_CLIENT_ID'))
    assert.isTrue(missing.includes('GITLAB_CLIENT_SECRET'))
    assert.isTrue(missing.includes('GITLAB_REDIRECT_URI'))
    assert.isFalse(svc.configured)
  })

  test('configured returns false when base URL invalid', ({ assert }) => {
    const svc = service({
      GITLAB_CLIENT_ID: 'id',
      GITLAB_CLIENT_SECRET: 'secret',
      GITLAB_REDIRECT_URI: 'uri',
      GITLAB_BASE_URL: 'http://insecure.example.com',
    })
    assert.isFalse(svc.configured)
  })

  // -----------------------------------------------------------------------
  // Base URL resolution
  // -----------------------------------------------------------------------

  test('resolveBaseUrl uses default when no env set', ({ assert }) => {
    const svc = service({})
    const result = svc.resolveBaseUrl()
    assert.isTrue(result.valid)
    assert.equal((result as { valid: true; url: string }).url, 'https://gitlab.com')
  })

  test('resolveBaseUrl rejects non-https URL', ({ assert }) => {
    const svc = service({ GITLAB_BASE_URL: 'http://insecure.gitlab.com' })
    const result = svc.resolveBaseUrl()
    assert.isFalse(result.valid)
  })

  test('resolveBaseUrl rejects malformed URL', ({ assert }) => {
    const svc = service({ GITLAB_BASE_URL: 'not-a-url' })
    const result = svc.resolveBaseUrl()
    assert.isFalse(result.valid)
  })

  test('resolveBaseUrl uses configured URL', ({ assert }) => {
    const svc = service()
    const result = svc.resolveBaseUrl()
    assert.isTrue(result.valid)
    assert.equal((result as { valid: true; url: string }).url, 'https://gitlab.example.com')
  })

  test('endpoints are derived from base URL', ({ assert }) => {
    const svc = service()
    assert.equal(svc.authEndpoint, 'https://gitlab.example.com/oauth/authorize')
    assert.equal(svc.tokenEndpoint, 'https://gitlab.example.com/oauth/token')
    assert.equal(svc.apiEndpoint, 'https://gitlab.example.com/api/v4')
  })

  test('instanceHost returns hostname', ({ assert }) => {
    const svc = service()
    assert.equal(svc.instanceHost, 'gitlab.example.com')
  })

  test('instanceHost returns null when base URL invalid', ({ assert }) => {
    const svc = service({ GITLAB_BASE_URL: 'invalid' })
    assert.isNull(svc.instanceHost)
  })

  // -----------------------------------------------------------------------
  // Authorization URL
  // -----------------------------------------------------------------------

  test('buildAuthorizationUrl generates valid URL with state', ({ assert }) => {
    const svc = service()
    const result = svc.buildAuthorizationUrl(testActor)
    const url = new URL(result.authorizationUrl)

    assert.equal(url.origin + url.pathname, 'https://gitlab.example.com/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), 'gitlab-client-id')
    assert.equal(url.searchParams.get('redirect_uri'), configuredEnv.GITLAB_REDIRECT_URI)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('scope'), 'read_user')
    assert.isString(url.searchParams.get('state'))
    assert.isString(result.stateExpiresAt)
  })

  test('buildAuthorizationUrl does not include write scopes', ({ assert }) => {
    const svc = service()
    const result = svc.buildAuthorizationUrl(testActor)
    const url = new URL(result.authorizationUrl)
    const scope = url.searchParams.get('scope') ?? ''

    // 不得包含写/提权 scope
    assert.notInclude(scope, 'api')
    assert.notInclude(scope, 'write_repository')
    assert.notInclude(scope, 'sudo')
    assert.notInclude(scope, 'admin_mode')
    assert.notInclude(scope, 'create_runner')
    assert.notInclude(scope, 'k8s_proxy')
    assert.notInclude(scope, 'write_')
    assert.notInclude(scope, 'read_api')
  })

  test('buildAuthorizationUrl throws when not configured', ({ assert }) => {
    const svc = service({})
    assert.throws(() => svc.buildAuthorizationUrl(testActor), /尚未配置/)
  })

  test('buildAuthorizationUrl throws with non-https base URL', ({ assert }) => {
    const svc = service({
      GITLAB_CLIENT_ID: 'id',
      GITLAB_CLIENT_SECRET: 'secret',
      GITLAB_REDIRECT_URI: 'uri',
      GITLAB_BASE_URL: 'http://insecure.example.com',
    })
    assert.throws(() => svc.buildAuthorizationUrl(testActor), /尚未配置/)
  })

  // -----------------------------------------------------------------------
  // Scope helpers
  // -----------------------------------------------------------------------

  test('hasWriteScopes detects write patterns', ({ assert }) => {
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['api']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['sudo']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['admin_mode']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['write_repository']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['create_runner']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['k8s_proxy']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['write_registry']))
    assert.isTrue(GitlabOAuthService.hasWriteScopes(['read_user', 'api']))
    assert.isFalse(GitlabOAuthService.hasWriteScopes(['read_user']))
    assert.isFalse(GitlabOAuthService.hasWriteScopes([]))
    assert.isFalse(GitlabOAuthService.hasWriteScopes(['read_api', 'read_user']))
  })

  // -----------------------------------------------------------------------
  // State verification
  // -----------------------------------------------------------------------

  test('verifyState accepts valid state', ({ assert }) => {
    const svc = service()
    const result = svc.buildAuthorizationUrl(testActor)
    const state = new URL(result.authorizationUrl).searchParams.get('state') ?? ''
    const payload = svc.verifyState(state)
    assert.equal(payload.userId, 1)
    assert.equal(payload.organizationId, 2)
    assert.equal(payload.provider, 'gitlab')
    assert.isString(payload.nonce)
    assert.isAbove(payload.expiresAt, Date.now())
  })

  test('verifyState rejects tampered state', ({ assert }) => {
    const svc = service()
    const tampered =
      'eyJ1c2VySWQiOjEsIm9yZ2FuaXphdGlvbklkIjoyLCJwcm92aWRlciI6ImdpdGxhYiIsIm5vbmNlIjoidGVzdCIsImV4cGlyZXNBdCI6OTk5OTk5OTk5OTk5OX0=.invalidsignature'
    assert.throws(() => svc.verifyState(tampered), /签名无效|格式无效/)
  })

  test('verifyState rejects expired state', ({ assert }) => {
    const svc = service()
    const payload: GitlabOAuthStatePayload = {
      userId: 1,
      organizationId: 2,
      provider: 'gitlab',
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

  test('verifyState rejects wrong provider', ({ assert }) => {
    const svc = service()
    const payload: GitlabOAuthStatePayload = {
      userId: 1,
      organizationId: 2,
      provider: 'gitlab',
      nonce: 'test',
      expiresAt: Date.now() + 60000,
    }
    // Manually create a state with 'github' as provider
    const badPayload = { ...payload, provider: 'github' as const }
    const encoded = Buffer.from(JSON.stringify(badPayload), 'utf8').toString('base64url')
    const sig = crypto
      .createHmac('sha256', svc['stateSecret']())
      .update(encoded)
      .digest('base64url')
    const state = `${encoded}.${sig}`
    assert.throws(() => svc.verifyState(state), /provider/)
  })

  test('signState and verifyState roundtrip preserves payload', ({ assert }) => {
    const svc = service()
    const payload: GitlabOAuthStatePayload = {
      userId: 42,
      organizationId: 7,
      provider: 'gitlab',
      nonce: crypto.randomBytes(8).toString('hex'),
      expiresAt: Date.now() + 60000,
    }
    const state = svc.signState(payload)
    const verified = svc.verifyState(state)
    assert.equal(verified.userId, 42)
    assert.equal(verified.organizationId, 7)
    assert.equal(verified.provider, 'gitlab')
    assert.equal(verified.nonce, payload.nonce)
  })

  // -----------------------------------------------------------------------
  // Token exchange (fixture)
  // -----------------------------------------------------------------------

  test('exchangeCode uses fixture adapter by default', async ({ assert }) => {
    const svc = service()
    const result = await svc.exchangeCode('test-code')
    assert.isString(result.access_token)
    assert.isTrue(result.access_token.startsWith('glpat_fixture_token_'))
    assert.equal(result.token_type, 'Bearer')
    assert.equal(result.scope, 'read_user')
    assert.isString(result.refresh_token)
    assert.isTrue(result.refresh_token!.startsWith('glrt_fixture_refresh_'))
    assert.equal(result.expires_in, 7200)
  })

  test('fixture adapter returns token without network call', async ({ assert }) => {
    const adapter = new GitlabTokenExchangeFixtureAdapter()
    const result = await adapter.exchangeCode(
      'any-code',
      'id',
      'secret',
      'uri',
      'https://gitlab.com/oauth/token',
    )
    assert.isString(result.access_token)
    assert.isTrue(result.access_token.startsWith('glpat_fixture_token_'))
    assert.isString(result.refresh_token)
  })

  test('fixture API client returns user without network', async ({ assert }) => {
    const client = new GitlabApiFixtureClient()
    const user = await client.getUser('any-token', 'https://gitlab.com/api/v4')
    assert.equal(user.username, 'fixture-gitlab-user')
    assert.equal(user.id, 54321)
    assert.equal(user.email, 'fixture@gitlab.com')
    assert.isFalse(user.is_admin)
  })

  test('default tests use fixture and make no real network calls', ({ assert }) => {
    // 断言默认构造使用 fixture adapter
    const svc = service()
    assert.instanceOf(svc['tokenExchange'], GitlabTokenExchangeFixtureAdapter)
    assert.instanceOf(svc['tokenRefresh'], GitlabTokenRefreshFixtureAdapter)
    assert.instanceOf(svc['apiClient'], GitlabApiFixtureClient)
  })

  // -----------------------------------------------------------------------
  // Token refresh (fixture)
  // -----------------------------------------------------------------------

  test('refreshAccessToken succeeds with valid refresh token', async ({ assert }) => {
    const svc = service()
    const encryptedRefresh = svc.encryptToken('glrt_test_refresh_token')
    const connection = new IntegrationConnection()
    connection.refreshTokenEncrypted = encryptedRefresh
    connection.accessTokenEncrypted = svc.encryptToken('old_access_token')

    // Mock save since we don't want to hit the DB
    let saved = false
    connection.save = async () => {
      saved = true
      return connection
    }

    const result = await svc.refreshAccessToken(connection)
    assert.isString(result)
    assert.isTrue(result.startsWith('glpat_fixture_refreshed_'))
    assert.isTrue(saved)
  })

  test('refreshAccessToken throws when refresh token missing', async ({ assert }) => {
    const svc = service()
    const connection = new IntegrationConnection()
    connection.refreshTokenEncrypted = null

    try {
      await svc.refreshAccessToken(connection)
      assert.fail('应该抛出异常')
    } catch (err: any) {
      assert.include(err.message, 'GitLab refresh token 缺失')
    }
  })

  test('refresh performs no write requests (fixture)', async ({ assert }) => {
    const svc = service()
    const encryptedRefresh = svc.encryptToken('glrt_test_refresh')
    const connection = new IntegrationConnection()
    connection.refreshTokenEncrypted = encryptedRefresh
    connection.accessTokenEncrypted = svc.encryptToken('old_access')
    connection.save = async () => connection

    // 使用 fixture adapter（默认），不会发出真实请求
    const result = await svc.refreshAccessToken(connection)
    assert.isTrue(result.startsWith('glpat_fixture_refreshed_'))
  })

  // -----------------------------------------------------------------------
  // User profile
  // -----------------------------------------------------------------------

  test('getUserProfile returns low-sensitive projection', async ({ assert }) => {
    const svc = service()
    const profile = await svc.getUserProfile('any-token')
    // 低敏字段存在
    assert.equal(profile.username, 'fixture-gitlab-user')
    assert.equal(profile.email, 'fixture@gitlab.com')
    assert.isString(profile.avatar_url)
    assert.isNumber(profile.id)
    // 不含 is_admin 等敏感字段
    assert.notProperty(profile, 'is_admin')
    assert.notProperty(profile, 'can_create_group')
    assert.notProperty(profile, 'can_create_project')
  })

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  test('healthCheck returns username and id', async ({ assert }) => {
    const svc = service()
    const health = await svc.healthCheck('any-token')
    assert.equal(health.username, 'fixture-gitlab-user')
    assert.equal(health.id, 54321)
  })

  // -----------------------------------------------------------------------
  // Token encryption
  // -----------------------------------------------------------------------

  test('encryptToken and decryptToken roundtrip', ({ assert }) => {
    const svc = service()
    const original = 'glpat_real_token_12345'
    const encrypted = svc.encryptToken(original)
    assert.notEqual(encrypted, original)
    assert.isTrue(encrypted.includes('.'))
    const decrypted = svc.decryptToken(encrypted)
    assert.equal(decrypted, original)
  })

  test('encrypted token is not plaintext', ({ assert }) => {
    const svc = service()
    const token = 'glpat_secret_token_abc'
    const encrypted = svc.encryptToken(token)
    assert.notInclude(encrypted, token)
    assert.notInclude(encrypted, 'glpat_')
  })

  // -----------------------------------------------------------------------
  // Production adapter type checks (no network)
  // -----------------------------------------------------------------------

  test('production token exchange adapter exists', ({ assert }) => {
    const adapter = new GitlabTokenExchangeProductionAdapter()
    assert.instanceOf(adapter, GitlabTokenExchangeProductionAdapter)
  })

  test('production token refresh adapter exists', ({ assert }) => {
    const adapter = new GitlabTokenRefreshProductionAdapter()
    assert.instanceOf(adapter, GitlabTokenRefreshProductionAdapter)
  })

  test('production API client exists', ({ assert }) => {
    const client = new GitlabApiProductionClient()
    assert.instanceOf(client, GitlabApiProductionClient)
  })
})
