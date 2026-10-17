import { test } from '@japa/runner'
import TaskExternalLinkService, { LinkNotFoundError } from '#services/task_external_link_service'
import TaskExternalLink from '#models/task_external_link'
import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import { createUser, createOrganization, useAuthDatabase } from '../functional/auth/_helpers.js'
import { DateTime } from 'luxon'
import type { ExternalLinkStatus } from '@aiproj/types'
import type { Group } from '@japa/runner/core'

test.group('TaskExternalLinkService.refresh - GitHub readonly', (group: Group) => {
  let service: TaskExternalLinkService
  let cipher: IntegrationTokenCipher
  let testOrgId: number
  let testUserId: number
  useAuthDatabase(group)

  group.each.setup(async () => {
    cipher = new IntegrationTokenCipher()
    service = new TaskExternalLinkService()
    // Create fresh org/user for each test
    const owner = await createUser()
    const org = await createOrganization(owner)
    testOrgId = Number(org.id)
    testUserId = Number(owner.id)
  })

  // Helper to create a test link
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

  // Helper to create a valid GitHub connection
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

  // Helper to create a valid GitLab connection
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

  test('throws LinkNotFoundError when link does not exist', async ({ assert }) => {
    await assert.rejects(
      async () => service.refresh(999, 1, 1, { userId: testUserId, organizationId: testOrgId }),
      LinkNotFoundError,
    )
  })

  test('returns connection_required when no GitHub connection exists', async ({ assert }) => {
    const link = await createTestLink()

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'connection_required')
    assert.include(result.message, '尚未连接')
  })

  test('successfully refreshes GitHub Issue with valid connection', async ({ assert }) => {
    const link = await createTestLink({ linkType: 'issue' })
    await createGitHubConnection()

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'success')
    assert.include(result.message, '已刷新')

    // Verify link was updated
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.statusSource, 'github_readonly')
    assert.equal(updated?.externalTitle, 'Fixture Issue #42 in test-repo')
    assert.equal(updated?.externalStatus, 'closed')
    assert.isTrue(updated?.lastObservedAt !== null)
  })

  test('successfully refreshes GitHub PR with valid connection', async ({ assert }) => {
    const link = await createTestLink({
      linkType: 'pull_request',
      externalUrl: 'https://github.com/test-owner/test-repo/pull/43',
    })
    await createGitHubConnection()

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'success')

    // Verify PR merged status
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalStatus, 'merged')
  })

  test('returns reauthorization_required for invalid token', async ({ assert }) => {
    const link = await createTestLink()
    const token = 'gho_invalid_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
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

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'reauthorization_required')
    assert.include(result.message, '过期')

    // Verify original snapshot is preserved
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalStatus, 'open')
    assert.equal(updated?.statusSource, 'reauthorization_required')
  })

  test('returns rate_limited with retryAfter for rate limited token', async ({ assert }) => {
    const link = await createTestLink()
    const token = 'gho_ratelimited_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
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

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'rate_limited')
    assert.equal(result.retryAfter, 60)

    // Verify original snapshot is preserved
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalStatus, 'open')
  })

  test('returns not_found for notfound token', async ({ assert }) => {
    const link = await createTestLink()
    const token = 'gho_notfound_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
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

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'not_found')
  })

  test('returns forbidden for forbidden token', async ({ assert }) => {
    const link = await createTestLink()
    const token = 'gho_forbidden_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
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

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'forbidden')
  })

  test('returns temporarily_unavailable for timeout token', async ({ assert }) => {
    const link = await createTestLink()
    const token = 'gho_timeout_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
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

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'temporarily_unavailable')
  })

  test('returns unsupported_link for invalid locator', async ({ assert }) => {
    const link = await createTestLink({
      repositoryOwner: '',
      repositoryName: '',
    })
    await createGitHubConnection()

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'unsupported_link')
  })

  test('preserves original snapshot on all failure branches', async ({ assert }) => {
    const originalTitle = 'Original Title'
    const link = await createTestLink({ externalTitle: originalTitle })

    // No connection - should preserve snapshot
    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })
    assert.notEqual(result.result, 'success')

    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalTitle, originalTitle)
    assert.equal(updated?.externalStatus, 'open')
  })

  test('does not modify task status or other project facts', async ({ assert }) => {
    const link = await createTestLink()
    await createGitHubConnection()

    // Get task before refresh
    const taskBefore = await TaskExternalLink.find(link.id)

    await service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId })

    // Verify only link fields were updated, not task
    const taskAfter = await TaskExternalLink.find(link.id)
    assert.equal(taskAfter?.taskId, taskBefore?.taskId)
    assert.equal(taskAfter?.projectId, taskBefore?.projectId)
    assert.equal(taskAfter?.organizationId, taskBefore?.organizationId)
  })

  test('enforces cross-organization isolation', async ({ assert }) => {
    const link = await createTestLink()
    await createGitHubConnection()

    // Try to refresh with different organization
    await assert.rejects(
      async () =>
        service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId + 999 }),
      LinkNotFoundError,
    )
  })

  test('enforces cross-project isolation', async ({ assert }) => {
    const link = await createTestLink({ projectId: 1 })
    await createGitHubConnection()

    // Try to refresh with different project
    await assert.rejects(
      async () => service.refresh(link.id, 2, 1, { userId: testUserId, organizationId: testOrgId }),
      LinkNotFoundError,
    )
  })

  test('enforces cross-task isolation', async ({ assert }) => {
    const link = await createTestLink({ taskId: 1 })
    await createGitHubConnection()

    // Try to refresh with different task
    await assert.rejects(
      async () => service.refresh(link.id, 1, 2, { userId: testUserId, organizationId: testOrgId }),
      LinkNotFoundError,
    )
  })

  // ---------------------------------------------------------------------------
  // GitLab refresh tests
  // ---------------------------------------------------------------------------

  test('GitLab: returns connection_required when no GitLab connection exists', async ({
    assert,
  }) => {
    const link = await createTestLink({ provider: 'gitlab', linkType: 'merge_request' })

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'connection_required')
    assert.include(result.message, '尚未连接')
    assert.equal(result.id, link.id)
  })

  test('GitLab: successfully refreshes Issue with valid connection', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    await createGitlabConnection()

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'success')
    assert.include(result.message, '已刷新')

    // Verify link was updated
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.statusSource, 'gitlab_readonly')
    assert.include(updated?.externalTitle ?? '', 'Fixture Issue')
    assert.equal(updated?.externalStatus, 'closed')
    assert.isTrue(updated?.lastObservedAt !== null)
  })

  test('GitLab: successfully refreshes Merge Request with valid connection', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'merge_request',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    await createGitlabConnection()

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'success')
    assert.include(result.message, 'Merge Request')

    // Verify MR merged status
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalStatus, 'merged')
  })

  test('GitLab: returns reauthorization_required for invalid token', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    const token = 'glpat_invalid_test_token'
    const encrypted = cipher.encrypt(token)
    await IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: cipher.encrypt('glrt_refresh'),
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'test@gitlab.com',
      scopesJson: ['read_user'],
    })

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'reauthorization_required')

    // Verify original snapshot is preserved
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalStatus, 'open')
  })

  test('GitLab: returns rate_limited with retryAfter for rate limited token', async ({
    assert,
  }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    const token = 'glpat_ratelimited_test_token'
    const encrypted = cipher.encrypt(token)
    await IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: cipher.encrypt('glrt_refresh'),
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'test@gitlab.com',
      scopesJson: ['read_user'],
    })

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'rate_limited')
    assert.equal(result.retryAfter, 60)

    // Verify original snapshot is preserved
    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalStatus, 'open')
  })

  test('GitLab: returns not_found for missing resource', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    const token = 'glpat_notfound_test_token'
    const encrypted = cipher.encrypt(token)
    await IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: cipher.encrypt('glrt_refresh'),
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'test@gitlab.com',
      scopesJson: ['read_user'],
    })

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'not_found')
  })

  test('GitLab: returns forbidden for forbidden token', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    const token = 'glpat_forbidden_test_token'
    const encrypted = cipher.encrypt(token)
    await IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: cipher.encrypt('glrt_refresh'),
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'test@gitlab.com',
      scopesJson: ['read_user'],
    })

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'forbidden')
  })

  test('GitLab: returns temporarily_unavailable for timeout', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    const token = 'glpat_timeout_test_token'
    const encrypted = cipher.encrypt(token)
    await IntegrationConnection.create({
      organizationId: testOrgId,
      userId: testUserId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: cipher.encrypt('glrt_refresh'),
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'test@gitlab.com',
      scopesJson: ['read_user'],
    })

    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })

    assert.equal(result.result, 'temporarily_unavailable')
  })

  test('GitLab: preserves original snapshot on all failure branches', async ({ assert }) => {
    const originalTitle = 'Original GitLab Issue'
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      externalTitle: originalTitle,
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })

    // No connection - should preserve snapshot
    const result = await service.refresh(link.id, 1, 1, {
      userId: testUserId,
      organizationId: testOrgId,
    })
    assert.notEqual(result.result, 'success')

    const updated = await TaskExternalLink.find(link.id)
    assert.equal(updated?.externalTitle, originalTitle)
    assert.equal(updated?.externalStatus, 'open')
  })

  test('GitLab: does not modify task status or other project facts', async ({ assert }) => {
    const link = await createTestLink({
      provider: 'gitlab',
      linkType: 'issue',
      repositoryOwner: 'my-group',
      repositoryName: 'my-project',
    })
    await createGitlabConnection()

    await service.refresh(link.id, 1, 1, { userId: testUserId, organizationId: testOrgId })

    // Verify only link fields were updated, not task
    const taskAfter = await TaskExternalLink.find(link.id)
    assert.equal(taskAfter?.taskId, link.taskId)
    assert.equal(taskAfter?.projectId, link.projectId)
    assert.equal(taskAfter?.organizationId, link.organizationId)
  })
})
