/**
 * v2-5-gitlab-readonly-oauth-connection —— GitLab provider registry 单元测试。
 *
 * 覆盖：provider config 状态、base URL 验证与 SSRF 边界、scope 白名单。
 * 所有测试使用 env overrides，不发起真实网络请求。
 */

import { test } from '@japa/runner'
import {
  getIntegrationProviderConfig,
  missingEnvKeys,
  validateGitlabBaseUrl,
  deriveGitlabEndpoint,
} from '#services/integrations/provider_registry'

test.group('GitLab Provider Registry', () => {
  // ---------------------------------------------------------------------------
  // Provider config
  // ---------------------------------------------------------------------------

  test('getIntegrationProviderConfig returns gitlab entry', ({ assert }) => {
    const config = getIntegrationProviderConfig('gitlab')
    assert.isNotNull(config)
    assert.equal(config!.provider, 'gitlab')
    assert.equal(config!.displayName, 'GitLab')
    assert.includeMembers(config!.capabilities, [
      'task_external_link',
      'status_snapshot',
      'safe_open_url',
      'gitlab_readonly_oauth',
    ])
    assert.includeMembers(config!.authMethods, ['oauth_redirect'])
    assert.includeMembers(config!.scopes, ['read_user'])
    assert.isNotEmpty(config!.authEndpoint)
    assert.isObject(config!.envKeys)
    assert.isString(config!.envKeys.baseUrl)
  })

  test('getIntegrationProviderConfig returns null for unknown provider', ({ assert }) => {
    assert.isNull(getIntegrationProviderConfig('unknown' as any))
  })

  test('missingEnvKeys detects all gitlab keys missing', ({ assert }) => {
    const config = getIntegrationProviderConfig('gitlab')!
    const missing = missingEnvKeys(config, {})
    assert.includeMembers(missing, [
      'GITLAB_CLIENT_ID',
      'GITLAB_CLIENT_SECRET',
      'GITLAB_REDIRECT_URI',
    ])
    assert.isAtLeast(missing.length, 3)
  })

  test('missingEnvKeys returns empty when gitlab fully configured', ({ assert }) => {
    const config = getIntegrationProviderConfig('gitlab')!
    const missing = missingEnvKeys(config, {
      GITLAB_CLIENT_ID: 'gitlab-client-id',
      GITLAB_CLIENT_SECRET: 'gitlab-client-secret',
      GITLAB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/gitlab/callback',
      GITLAB_BASE_URL: 'https://gitlab.example.com',
    })
    // baseUrl is now in required env keys, so all 4 should be satisfied
    assert.isEmpty(missing)
  })

  test('missingEnvKeys returns partial missing', ({ assert }) => {
    const config = getIntegrationProviderConfig('gitlab')!
    const missing = missingEnvKeys(config, {
      GITLAB_CLIENT_ID: 'id',
    })
    assert.isFalse(missing.includes('GITLAB_CLIENT_ID'))
    assert.isTrue(missing.includes('GITLAB_CLIENT_SECRET'))
  })

  // ---------------------------------------------------------------------------
  // Scope allowlist
  // ---------------------------------------------------------------------------

  test('gitlab scopes do not include write/admin/sudo/api-full scopes', ({ assert }) => {
    const config = getIntegrationProviderConfig('gitlab')!
    const scopes = config.scopes
    // 首期最小只读
    assert.includeMembers(scopes, ['read_user'])
    // 不得包含写/提权 scope
    assert.notInclude(scopes, 'api')
    assert.notInclude(scopes, 'write_repository')
    assert.notInclude(scopes, 'sudo')
    assert.notInclude(scopes, 'admin_mode')
    assert.notInclude(scopes, 'create_runner')
    assert.notInclude(scopes, 'k8s_proxy')
  })

  // ---------------------------------------------------------------------------
  // Base URL validation (SSRF boundary)
  // ---------------------------------------------------------------------------

  test('validateGitlabBaseUrl accepts valid https URL', ({ assert }) => {
    const result = validateGitlabBaseUrl('https://gitlab.com')
    assert.isTrue(result.valid)
    assert.equal(result.url?.origin, 'https://gitlab.com')
  })

  test('validateGitlabBaseUrl accepts https self-hosted URL', ({ assert }) => {
    const result = validateGitlabBaseUrl('https://gitlab.example.com')
    assert.isTrue(result.valid)
    assert.equal(result.url?.hostname, 'gitlab.example.com')
  })

  test('validateGitlabBaseUrl accepts https URL with path', ({ assert }) => {
    const result = validateGitlabBaseUrl('https://gitlab.example.com/gitlab')
    assert.isTrue(result.valid)
  })

  test('validateGitlabBaseUrl rejects non-https URL', ({ assert }) => {
    const result = validateGitlabBaseUrl('http://gitlab.example.com')
    assert.isFalse(result.valid)
    assert.equal(result.reason, 'base_url_not_https')
  })

  test('validateGitlabBaseUrl rejects empty URL', ({ assert }) => {
    const result = validateGitlabBaseUrl('')
    assert.isFalse(result.valid)
    assert.equal(result.reason, 'base_url_missing')
  })

  test('validateGitlabBaseUrl rejects undefined URL', ({ assert }) => {
    const result = validateGitlabBaseUrl(undefined)
    assert.isFalse(result.valid)
    assert.equal(result.reason, 'base_url_missing')
  })

  test('validateGitlabBaseUrl rejects malformed URL', ({ assert }) => {
    const result = validateGitlabBaseUrl('not-a-url')
    assert.isFalse(result.valid)
    assert.include(['base_url_malformed'], result.reason!)
  })

  test('validateGitlabBaseUrl rejects blank URL', ({ assert }) => {
    const result = validateGitlabBaseUrl('   ')
    assert.isFalse(result.valid)
  })

  // ---------------------------------------------------------------------------
  // Endpoint derivation
  // ---------------------------------------------------------------------------

  test('deriveGitlabEndpoint builds authorize endpoint', ({ assert }) => {
    const endpoint = deriveGitlabEndpoint('https://gitlab.com', 'authorize')
    assert.equal(endpoint, 'https://gitlab.com/oauth/authorize')
  })

  test('deriveGitlabEndpoint builds token endpoint', ({ assert }) => {
    const endpoint = deriveGitlabEndpoint('https://gitlab.com', 'token')
    assert.equal(endpoint, 'https://gitlab.com/oauth/token')
  })

  test('deriveGitlabEndpoint builds API endpoint', ({ assert }) => {
    const endpoint = deriveGitlabEndpoint('https://gitlab.com', 'api')
    assert.equal(endpoint, 'https://gitlab.com/api/v4')
  })

  test('deriveGitlabEndpoint handles trailing slash', ({ assert }) => {
    const endpoint = deriveGitlabEndpoint('https://gitlab.example.com/', 'authorize')
    assert.equal(endpoint, 'https://gitlab.example.com/oauth/authorize')
  })

  test('deriveGitlabEndpoint handles self-hosted path', ({ assert }) => {
    const endpoint = deriveGitlabEndpoint('https://gitlab.example.com/gitlab', 'authorize')
    assert.equal(endpoint, 'https://gitlab.example.com/gitlab/oauth/authorize')
  })
})
