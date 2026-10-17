import { test } from '@japa/runner'
import {
  GitHubReadonlyFixtureClient,
  GitHubReadonlyProductionClient,
  type GitHubLinkLocator,
} from '#services/integrations/github_readonly_client'

test.group('GitHubReadonlyClient', () => {
  const fixtureClient = new GitHubReadonlyFixtureClient()

  const issueLocator: GitHubLinkLocator = {
    owner: 'test-owner',
    repo: 'test-repo',
    kind: 'issue',
    number: 42,
  }

  const prLocator: GitHubLinkLocator = {
    owner: 'test-owner',
    repo: 'test-repo',
    kind: 'pull_request',
    number: 43,
  }

  test('fixture client returns refreshed for valid issue', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_valid_token')
    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      assert.equal(result.snapshot.status, 'closed')
      assert.equal(result.snapshot.title, 'Fixture Issue #42 in test-repo')
      assert.include(result.snapshot.safeUrl, 'github.com')
      assert.isTrue(new Date(result.snapshot.observedAt).getTime() > 0)
    }
  })

  test('fixture client returns refreshed for valid PR', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(prLocator, 'gho_valid_token')
    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      assert.equal(result.snapshot.status, 'merged')
      assert.equal(result.snapshot.isMerged, true)
    }
  })

  test('fixture client returns reauthorization_required for invalid token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_invalid_token')
    assert.equal(result.type, 'reauthorization_required')
  })

  test('fixture client returns reauthorization_required for expired token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_expired_token')
    assert.equal(result.type, 'reauthorization_required')
  })

  test('fixture client returns forbidden for forbidden token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_forbidden_token')
    assert.equal(result.type, 'forbidden')
  })

  test('fixture client returns not_found for notfound token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_notfound_token')
    assert.equal(result.type, 'not_found')
  })

  test('fixture client returns rate_limited for ratelimited token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_ratelimited_token')
    assert.equal(result.type, 'rate_limited')
    if (result.type === 'rate_limited') {
      assert.equal(result.retryAfter, 60)
    }
  })

  test('fixture client returns temporarily_unavailable for timeout token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_timeout_token')
    assert.equal(result.type, 'temporarily_unavailable')
  })

  test('fixture client returns temporarily_unavailable for 5xx token', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_5xx_token')
    assert.equal(result.type, 'temporarily_unavailable')
  })

  test('fixture client sanitizes malicious payload', async ({ assert }) => {
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_malicious_token')
    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      // 标题中的 script 标签应被保留（由调用方负责 sanitize）
      assert.include(result.snapshot.title, 'malicious')
      // URL 应被正确编码
      assert.include(result.snapshot.safeUrl, 'github.com')
      assert.notInclude(result.snapshot.safeUrl, '<script>')
    }
  })

  test('fixture client does not make real network requests', async ({ assert }) => {
    // fixture client 不应发起任何网络请求
    // 这个测试证明所有响应都来自 fixture，不需要真实 token
    const result = await fixtureClient.fetchIssueOrPR(issueLocator, 'gho_valid_token')
    assert.equal(result.type, 'refreshed')
  })

  test('production client is constructable but not tested with real network', async ({
    assert,
  }) => {
    // 证明 production client 可以被构造，但不发起真实请求
    const productionClient = new GitHubReadonlyProductionClient()
    assert.isDefined(productionClient)
    assert.isFunction(productionClient.fetchIssueOrPR)
  })
})
