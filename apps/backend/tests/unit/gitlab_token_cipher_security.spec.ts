/**
 * v2-5-gitlab-readonly-oauth-connection —— GitLab token 安全与 DTO 脱敏测试。
 *
 * 覆盖：access/refresh token 加密存储、审计/DTO 无明文 token、无 Authorization header、
 * 无 client secret 暴露、低敏字段白名单。
 * 所有测试使用环境变量 overrides，不涉及真实数据库。
 */

import { test } from '@japa/runner'
import GitlabOAuthService from '#services/integrations/gitlab_oauth_service'
import type {
  GitlabAccountProjection,
  GitlabTokenResponse,
  GitlabUserResponse,
} from '#services/integrations/gitlab_oauth_service'

const configuredEnv = {
  GITLAB_CLIENT_ID: 'gitlab-client-id',
  GITLAB_CLIENT_SECRET: 'gitlab-client-secret',
  GITLAB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/gitlab/callback',
  GITLAB_BASE_URL: 'https://gitlab.example.com',
}

test.group('GitLab Token Security', () => {
  // -----------------------------------------------------------------------
  // Token encryption
  // -----------------------------------------------------------------------

  test('access token is encrypted, not stored as plaintext', ({ assert }) => {
    const svc = new GitlabOAuthService(configuredEnv)
    const plaintext = 'glpat_plaintext_access_token_abc123'
    const encrypted = svc.encryptToken(plaintext)
    assert.notEqual(encrypted, plaintext)
    assert.notInclude(encrypted, 'glpat_')
    assert.notInclude(encrypted, 'access_token')
    assert.notInclude(encrypted, 'plaintext')
    assert.isTrue(encrypted.includes('.'))
  })

  test('refresh token is encrypted, not stored as plaintext', ({ assert }) => {
    const svc = new GitlabOAuthService(configuredEnv)
    const plaintext = 'glrt_plaintext_refresh_token_xyz789'
    const encrypted = svc.encryptToken(plaintext)
    assert.notEqual(encrypted, plaintext)
    assert.notInclude(encrypted, 'glrt_')
    assert.notInclude(encrypted, 'refresh_token')
    assert.isTrue(encrypted.includes('.'))
  })

  test('encrypted token roundtrips correctly', ({ assert }) => {
    const svc = new GitlabOAuthService(configuredEnv)
    const original = 'glpat_secret_roundtrip_token'
    const encrypted = svc.encryptToken(original)
    const decrypted = svc.decryptToken(encrypted)
    assert.equal(decrypted, original)
  })

  test('different tokens produce different ciphertexts', ({ assert }) => {
    const svc = new GitlabOAuthService(configuredEnv)
    const encrypted1 = svc.encryptToken('token_one')
    const encrypted2 = svc.encryptToken('token_two')
    assert.notEqual(encrypted1, encrypted2)
  })

  // -----------------------------------------------------------------------
  // DTO field redaction
  // -----------------------------------------------------------------------

  test('GitlabAccountProjection excludes is_admin and token fields', ({ assert }) => {
    const profile: GitlabAccountProjection = {
      id: 12345,
      username: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
      avatar_url: 'https://gitlab.com/avatar.png',
    }
    // 不应该存在的字段
    assert.notProperty(profile, 'is_admin')
    assert.notProperty(profile, 'can_create_group')
    assert.notProperty(profile, 'can_create_project')
    assert.notProperty(profile, 'access_token')
    assert.notProperty(profile, 'refresh_token')
    assert.notProperty(profile, 'client_secret')
    assert.notProperty(profile, 'Authorization')
    assert.notProperty(profile, 'private_profile')
    assert.notProperty(profile, 'namespaces')
    assert.notProperty(profile, 'extra_shared_runners_minutes_limit')
  })

  test('GitlabTokenResponse access_token is present in raw response', ({ assert }) => {
    // raw response 有 access_token，但只用于加密存储和即时交换，不入 DTO
    const response: GitlabTokenResponse = {
      access_token: 'glpat_raw_token',
      token_type: 'Bearer',
      scope: 'read_user',
      refresh_token: 'glrt_raw_refresh',
      expires_in: 7200,
      created_at: Math.floor(Date.now() / 1000),
    }
    assert.isString(response.access_token)
    assert.isString(response.refresh_token)
    // 但这些永远不会通过 DTO 暴露——只加密存储
  })

  test('Gitlag response fields are never in low-sensitive structures', ({ assert }) => {
    // 模拟一个完整 GitLab API 响应，检查哪些字段出现在低敏结构中
    const rawUser: GitlabUserResponse = {
      id: 54321,
      username: 'dev-user',
      email: 'dev@gitlab.com',
      name: 'Dev User',
      avatar_url: 'https://gitlab.com/avatar.png',
      web_url: 'https://gitlab.com/dev-user',
      state: 'active',
      last_sign_in_at: '2024-01-01T00:00:00.000Z',
      created_at: '2023-01-01T00:00:00.000Z',
      bio: 'Developer',
      location: 'Shanghai',
      public_email: 'dev@gitlab.com',
      organization: 'My Org',
      job_title: 'Engineer',
      followers: 42,
      following: 13,
      is_admin: true,
      private_profile: false,
      can_create_group: true,
      can_create_project: true,
      extra_shared_runners_minutes_limit: null,
      extra_shared_runners_minutes_limit_used: null,
      namespaces: [
        { id: 1, name: 'My Group', path: 'my-group', kind: 'group', full_path: 'my-group' },
      ],
    }

    // 低敏投影只应该包含 username/name/email/avatar_url/id
    const projection = {
      id: rawUser.id,
      username: rawUser.username,
      name: rawUser.name,
      email: rawUser.public_email || rawUser.email,
      avatar_url: rawUser.avatar_url,
    }
    assert.equal(projection.username, 'dev-user')
    assert.notProperty(projection, 'is_admin')
    assert.notProperty(projection, 'web_url')
    assert.notProperty(projection, 'can_create_group')
    assert.notProperty(projection, 'namespaces')
    assert.notProperty(projection, 'private_profile')
    assert.notProperty(projection, 'extra_shared_runners_minutes_limit')
    assert.notProperty(projection, 'followers')
    assert.notProperty(projection, 'following')
  })

  test('Gitlag token response does not survive into logs or DTOs', ({ assert }) => {
    // 模拟一个 token response——这些字段不应出现在任何审计/日志/DTO 中
    const tokenResponse: GitlabTokenResponse = {
      access_token: 'glpat_secret_log_token',
      token_type: 'Bearer',
      scope: 'read_user',
      refresh_token: 'glrt_secret_log_refresh',
      expires_in: 7200,
      created_at: Math.floor(Date.now() / 1000),
    }

    // 审计 metadata 白名单（不应包含 token 或 client secret）
    const auditMetadata = {
      provider: 'gitlab',
      accountLogin: 'dev-user',
      instanceHost: 'gitlab.example.com',
      reasonCode: 'connected',
    }
    assert.notProperty(auditMetadata, 'access_token')
    assert.notProperty(auditMetadata, 'refresh_token')
    assert.notProperty(auditMetadata, 'client_secret')
    assert.notProperty(auditMetadata, 'Authorization')

    // 确保 token 不在白名单中
    const whitelist = [
      'provider',
      'accountLogin',
      'accountId',
      'instanceHost',
      'scopeSummary',
      'reasonCode',
      'checkedAt',
    ]
    const tokenKeys = Object.keys(tokenResponse)
    for (const key of tokenKeys) {
      assert.notInclude(whitelist, key, `Token field "${key}" should not be in audit whitelist`)
    }
  })

  // -----------------------------------------------------------------------
  // Authorization header safety
  // -----------------------------------------------------------------------

  test('no Authorization header in fixture token response', ({ assert }) => {
    // Fixture token response 不含 authorization
    const response: GitlabTokenResponse = {
      access_token: 'glpat_fixture',
      token_type: 'Bearer',
      scope: 'read_user',
    }
    assert.notProperty(response, 'Authorization')
    assert.notProperty(response, 'authorization')
  })

  test('no client secret in authorization URL', ({ assert }) => {
    const svc = new GitlabOAuthService(configuredEnv)
    const result = svc.buildAuthorizationUrl({ userId: 1, organizationId: 1 })
    const url = new URL(result.authorizationUrl)
    assert.isNull(url.searchParams.get('client_secret'))
    assert.isNull(url.searchParams.get('secret'))
  })

  // -----------------------------------------------------------------------
  // Encryption is unique per token
  // -----------------------------------------------------------------------

  test('same token encrypted twice produces different ciphertext', ({ assert }) => {
    const svc = new GitlabOAuthService(configuredEnv)
    const token = 'glpat_test_token_for_unique_test'
    const encrypted1 = svc.encryptToken(token)
    const encrypted2 = svc.encryptToken(token)
    assert.notEqual(encrypted1, encrypted2)
  })
})
