/**
 * v2-5-gitlab-linked-item-read-refresh —— 并发与限流测试（4.7）。
 *
 * 覆盖：同一链接并发刷新、失败不覆盖成功、429 retry-after 上限、
 * token 续期后重试、超时后的可重试结果。
 */

import { test } from '@japa/runner'
import TaskExternalLinkService from '#services/task_external_link_service'
import TaskExternalLink from '#models/task_external_link'
import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import { GitLabReadonlyFixtureClient } from '#services/integrations/gitlab_readonly_client'
import { GitlabConnectionResolver } from '#services/integrations/gitlab_connection_resolver'
import { createUser, createOrganization, useAuthDatabase } from '../functional/auth/_helpers.js'
import { DateTime } from 'luxon'
import type { ExternalLinkStatus } from '@aiproj/types'
import type { Group } from '@japa/runner/core'

test.group('TaskExternalLinkService.refresh - Concurrency', (group: Group) => {
  let cipher: IntegrationTokenCipher
  let testOrgId: number
  let testUserId: number
  useAuthDatabase(group)

  group.each.setup(async () => {
    cipher = new IntegrationTokenCipher()
    const owner = await createUser()
    const org = await createOrganization(owner)
    testOrgId = Number(org.id)
    testUserId = Number(owner.id)
  })

  async function createTestLink(overrides: Partial<TaskExternalLink> = {}) {
    return TaskExternalLink.create({
      organizationId: testOrgId,
      projectId: 1,
      taskId: 1,
      provider: 'github',
      linkType: 'issue',
      repositoryOwner: 'test-owner',
      repositoryName: 'test-repo',
      externalNumber: 42,
      externalId: null,
      externalTitle: 'Test Issue',
      externalStatus: 'open' as ExternalLinkStatus,
      statusSource: 'manual',
      externalUrl: 'https://github.com/test-owner/test-repo/issues/42',
      note: null,
      metadata: null,
      lastObservedAt: DateTime.utc().minus({ days: 1 }),
      createdBy: testUserId,
      updatedBy: testUserId,
      ...overrides,
    })
  }

  async function createGitHubConnection() {
    const token = 'gho_valid_token'
    const encrypted = cipher.encrypt(token)
    return IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'test@example.com',
      scopesJson: ['read:user', 'user:email'],
    })
  }

  async function createGitlabConnection() {
    const token = 'glpat_valid_token'
    const encrypted = cipher.encrypt(token)
    return IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: cipher.encrypt('glrt_valid_refresh'),
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'fixture-user',
      scopesJson: ['read_user'],
    })
  }

  // 4.7: 并发刷新 —— 最后一次完整成功优先
  test('concurrent refreshes: last complete success wins', async ({ assert }) => {
    const service = new TaskExternalLinkService()
    const link = await createTestLink()
    await createGitHubConnection()

    const [result1, result2] = await Promise.all([
      service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId }),
      service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId }),
    ])

    assert.equal(result1.result, 'success')
    assert.equal(result2.result, 'success')

    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.statusSource, 'github_readonly')
    assert.isTrue(updated?.lastObservedAt !== null)
  })

  // 4.7: 失败不覆盖成功
  test('failure never overwrites a successful snapshot', async ({ assert }) => {
    const service = new TaskExternalLinkService()
    const link = await createTestLink()
    await createGitHubConnection()

    const result1 = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })
    assert.equal(result1.result, 'success')

    const afterSuccess = await TaskExternalLink.find(link.id)
    const successTitle = afterSuccess?.externalTitle
    const successStatus = afterSuccess?.externalStatus

    // 用错误的 user/org 尝试刷新，会抛出 LinkNotFoundError（不会覆盖快照）
    try {
      await service.refresh(link.id, 1, 1, {
        userId: testUserId + 999,
        organizationId: testOrgId + 999,
      })
    } catch {
      // 预期异常
    }

    const afterFailure = await TaskExternalLink.find(link.id)
    assert.equal(afterFailure?.externalTitle, successTitle)
    assert.equal(afterFailure?.externalStatus, successStatus)
  })

  // 4.7: 同一链接重复请求（幂等性）
  test('duplicate refresh requests are idempotent', async ({ assert }) => {
    const service = new TaskExternalLinkService()
    const link = await createTestLink()
    await createGitHubConnection()

    const r1 = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })
    assert.equal(r1.result, 'success')

    const r2 = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })
    assert.equal(r2.result, 'success')

    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.statusSource, 'github_readonly')
    assert.isNotNull(updated?.lastObservedAt)
  })

  // 4.7: GitLab 并发刷新
  test('GitLab concurrent refreshes are safe', async ({ assert }) => {
    const service = new TaskExternalLinkService()
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    await createGitlabConnection()

    const [r1, r2] = await Promise.all([
      service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId }),
      service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId }),
    ])

    assert.equal(r1.result, 'success')
    assert.equal(r2.result, 'success')

    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.statusSource, 'gitlab_readonly')
  })

  // 4.7: 429 retry-after 上限
  test('rate limited result includes bounded retry-after', async ({ assert }) => {
    const client = new GitLabReadonlyFixtureClient()
    const locator = {
      baseUrl: 'https://gitlab.com',
      projectPath: 'group/project',
      kind: 'issue' as const,
      iid: 1,
    }

    const result = await client.fetchIssueOrMR(locator, 'glpat_ratelimited_token')

    assert.equal(result.type, 'rate_limited')
    if (result.type === 'rate_limited') {
      assert.isBelow(result.retryAfter ?? 0, 3601)
      assert.isAbove(result.retryAfter ?? 0, 0)
    }
  })

  // 4.7: token 续期后重试
  test('GitLab resolver renews token when near expiry', async ({ assert }) => {
    const encrypted = cipher.encrypt('glpat_near_expiry')
    const encryptedRefresh = cipher.encrypt('glrt_valid_refresh')
    await IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: encryptedRefresh,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ seconds: 60 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'fixture-user',
      scopesJson: ['read_user'],
    })

    const resolver = new GitlabConnectionResolver()
    const result = await resolver.resolve(testOrgId, testUserId)

    assert.equal(result.type, 'connected')
    if (result.type === 'connected') {
      assert.include(result.accessToken, 'glpat_fixture_refreshed_')
    }
  })

  // 4.7: 超时后的可重试结果
  test('timeout returns retryable temporarily_unavailable', async ({ assert }) => {
    const client = new GitLabReadonlyFixtureClient()
    const locator = {
      baseUrl: 'https://gitlab.com',
      projectPath: 'group/project',
      kind: 'issue' as const,
      iid: 1,
    }

    const result = await client.fetchIssueOrMR(locator, 'glpat_timeout_token')

    assert.equal(result.type, 'temporarily_unavailable')
  })
})
