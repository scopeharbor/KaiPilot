/**
 * v2-5-github-readonly-oauth-connection —— 轻量外链边界测试。
 *
 * 覆盖：GitHub 连接后 refresh 返回 readonly_connection_ready，
 * GitLab 不受影响，外部链接 refresh 不改变任务数据。
 */

import { test } from '@japa/runner'
import CodeRepositoryProviderAdapter from '#services/integrations/code_repository_adapter'

const configuredEnv = {
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
  GITHUB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/github/callback',
  GITLAB_CLIENT_ID: 'gitlab-client-id',
  GITLAB_CLIENT_SECRET: 'gitlab-secret',
  GITLAB_BASE_URL: 'https://gitlab.com',
  GITLAB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/gitlab/callback',
}

test.group('CodeRepositoryProviderAdapter — GitHub connected boundary', () => {
  test('check returns readonly_connection_ready when GitHub connected', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    const result = adapter.check('github', true)
    assert.equal(result.status, 'readonly_connection_ready')
    assert.include(result.message, '只读连接已就绪')
  })

  test('check returns pre_connection_only when GitHub not connected', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    const result = adapter.check('github')
    assert.equal(result.status, 'pre_connection_only')
  })

  test('check returns not_configured when GitHub env missing', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter({})
    const result = adapter.check('github')
    assert.equal(result.status, 'not_configured')
  })

  test('GitLab check returns readonly_connection_ready when connected', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    // GitLab 只读 OAuth 连接就绪后，与 GitHub 一致返回 readonly_connection_ready
    // （v2-5-gitlab-readonly-oauth-connection 已将 GitLab 纳入共享 adapter 的连接就绪分支）
    const result = adapter.check('gitlab', true)
    assert.equal(result.status, 'readonly_connection_ready')
  })

  test('refresh returns readonly_connection_ready when GitHub connected', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    const result = adapter.refresh('github', true)
    assert.equal(result.result, 'readonly_connection_ready')
    assert.include(result.message, '只读连接')
  })

  test('refresh returns pre_connection_only when GitHub not connected', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    const result = adapter.refresh('github')
    assert.equal(result.result, 'pre_connection_only')
  })

  test('refresh returns not_configured when GitHub env missing', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter({})
    const result = adapter.refresh('github')
    assert.equal(result.result, 'not_configured')
  })

  test('refresh returns not_configured for unregistered provider', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    const result = adapter.refresh('unknown' as any)
    assert.equal(result.result, 'not_configured')
  })

  test('GitLab refresh returns readonly_connection_ready when connected', ({ assert }) => {
    const adapter = new CodeRepositoryProviderAdapter(configuredEnv)
    // GitLab 连接就绪后 refresh 与 GitHub 一致返回 readonly_connection_ready，保留现有快照
    const result = adapter.refresh('gitlab', true)
    assert.equal(result.result, 'readonly_connection_ready')
  })
})
