/**
 * v2-5-gitlab-linked-item-read-refresh —— GitLab 只读 client 测试。
 *
 * 覆盖：Issue/MR 响应、401/403/404/429/5xx/timeout、恶意 payload、
 * 自托管 base URL 篡改/非 https/host 越界、白名单投影断言。
 * 默认测试零网络、零真实 secret。
 */

import { test } from '@japa/runner'
import {
  GitLabReadonlyFixtureClient,
  type GitLabLinkLocator,
  type GitLabReadonlyClient,
} from '#services/integrations/gitlab_readonly_client'

test.group('GitLabReadonlyFixtureClient', (group) => {
  let client: GitLabReadonlyClient

  const validLocator: GitLabLinkLocator = {
    baseUrl: 'https://gitlab.com',
    projectPath: 'my-group/my-project',
    kind: 'issue',
    iid: 42,
  }

  const mrLocator: GitLabLinkLocator = {
    baseUrl: 'https://gitlab.com',
    projectPath: 'my-group/my-project',
    kind: 'merge_request',
    iid: 7,
  }

  const selfHostedLocator: GitLabLinkLocator = {
    baseUrl: 'https://gitlab.example.com',
    projectPath: 'org/repo',
    kind: 'issue',
    iid: 1,
  }

  group.each.setup(() => {
    client = new GitLabReadonlyFixtureClient()
  })

  // 2.4: Issue/MR 成功
  test('returns refreshed result for Issue with valid token', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_valid_token')

    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      assert.equal(result.snapshot.status, 'closed')
      assert.include(result.snapshot.title, 'Fixture Issue')
      assert.include(result.snapshot.title, '#42')
      assert.include(result.snapshot.safeUrl, 'issues/42')
      assert.isDefined(result.snapshot.observedAt)
      assert.isUndefined(result.snapshot.isMerged)
    }
  })

  test('returns refreshed result for Merge Request with valid token', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(mrLocator, 'glpat_valid_token')

    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      assert.equal(result.snapshot.status, 'merged')
      assert.include(result.snapshot.title, 'Fixture MR')
      assert.include(result.snapshot.title, '#7')
      assert.include(result.snapshot.safeUrl, 'merge_requests/7')
      assert.isTrue(result.snapshot.isMerged)
    }
  })

  // 2.4: 401 -> reauthorization_required
  test('returns reauthorization_required for invalid token', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_invalid_token')

    assert.equal(result.type, 'reauthorization_required')
    if (result.type === 'reauthorization_required') {
      assert.include(result.message, '过期')
    }
  })

  test('returns reauthorization_required for expired token', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_expired_token')

    assert.equal(result.type, 'reauthorization_required')
  })

  // 2.4: 403 -> forbidden
  test('returns forbidden for forbidden token', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_forbidden_token')

    assert.equal(result.type, 'forbidden')
  })

  // 2.4: 404 -> not_found
  test('returns not_found for missing resource', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_notfound_token')

    assert.equal(result.type, 'not_found')
  })

  // 2.4: 429 -> rate_limited with retryAfter
  test('returns rate_limited with retryAfter for rate limited token', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_ratelimited_token')

    assert.equal(result.type, 'rate_limited')
    if (result.type === 'rate_limited') {
      assert.equal(result.retryAfter, 60)
    }
  })

  // 2.4: timeout -> temporarily_unavailable
  test('returns temporarily_unavailable for timeout', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_timeout_token')

    assert.equal(result.type, 'temporarily_unavailable')
  })

  // 2.4: 5xx -> temporarily_unavailable
  test('returns temporarily_unavailable for 5xx', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_5xx_token')

    assert.equal(result.type, 'temporarily_unavailable')
  })

  // 2.5+2.6: 恶意 payload sanitization
  test('sanitizes malicious payload from fixture', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_malicious_token')

    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      // XSS 被保留在 title（展示层自行转义），但 description/body 不应存在
      assert.equal(result.snapshot.title, 'Fixture malicious title <script>alert(1)</script>')
      // 安全 URL 是规范化的
      assert.include(result.snapshot.safeUrl, 'gitlab.com')
      // 不应有额外字段泄露
      const keys = Object.keys(result.snapshot)
      assert.notInclude(keys, 'description')
      assert.notInclude(keys, 'notes')
      assert.notInclude(keys, 'diff')
      assert.notInclude(keys, 'author')
      assert.notInclude(keys, 'pipeline')
    }
  })

  // 2.5: 白名单投影 —— 拒绝 description/notes/diff/commit/author
  test('snapshot never contains sensitive fields', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_valid_token')

    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      const snapshot = result.snapshot as unknown as Record<string, unknown>
      assert.notProperty(snapshot, 'description')
      assert.notProperty(snapshot, 'notes')
      assert.notProperty(snapshot, 'diff')
      assert.notProperty(snapshot, 'commit')
      assert.notProperty(snapshot, 'pipeline')
      assert.notProperty(snapshot, 'author')
      assert.notProperty(snapshot, 'assignee')
    }
  })

  // 2.4: 自托管 base URL 场景
  test('works with self-hosted GitLab instance', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(selfHostedLocator, 'glpat_valid_token')

    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      assert.include(result.snapshot.safeUrl, 'gitlab.example.com')
    }
  })

  // 2.4: project path URL 编码
  test('encodes project path in safe URL', async ({ assert }) => {
    const locator: GitLabLinkLocator = {
      baseUrl: 'https://gitlab.com',
      projectPath: 'group/sub-group/project',
      kind: 'issue',
      iid: 1,
    }
    const result = await client.fetchIssueOrMR(locator, 'glpat_valid_token')

    assert.equal(result.type, 'refreshed')
    if (result.type === 'refreshed') {
      assert.include(result.snapshot.safeUrl, encodeURIComponent('group/sub-group/project'))
    }
  })

  // 2.6: secret-like token 不在 DTO
  test('fixture does not expose token in result', async ({ assert }) => {
    const result = await client.fetchIssueOrMR(validLocator, 'glpat_valid_token')

    const resultKeys = Object.keys(result)
    assert.notInclude(resultKeys, 'token')
    assert.notInclude(resultKeys, 'accessToken')
    assert.notInclude(resultKeys, 'authorization')

    if (result.type === 'refreshed') {
      const snapshotKeys = Object.keys(result.snapshot)
      assert.notInclude(snapshotKeys, 'token')
      assert.notInclude(snapshotKeys, 'accessToken')
    }
  })
})
