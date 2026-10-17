/**
 * v2-5-gitlab-linked-item-read-refresh —— GitLab 连接解析测试。
 *
 * 覆盖：无连接、预连接、过期可续期、过期续期失败、撤销、
 * 跨用户与跨组织隔离。
 */

import { test } from '@japa/runner'
import { GitlabConnectionResolver } from '#services/integrations/gitlab_connection_resolver'
import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import { createUser, createOrganization, useAuthDatabase } from '../functional/auth/_helpers.js'
import { DateTime } from 'luxon'
import type { Group } from '@japa/runner/core'

test.group('GitlabConnectionResolver', (group: Group) => {
  let resolver: GitlabConnectionResolver
  let cipher: IntegrationTokenCipher
  useAuthDatabase(group)

  group.each.setup(async () => {
    cipher = new IntegrationTokenCipher()
    resolver = new GitlabConnectionResolver()
  })

  // Helper
  async function createGitlabConnection(
    userId: number,
    organizationId: number,
    overrides: Partial<IntegrationConnection> = {},
  ) {
    const token = 'glpat_valid_test_token'
    const refreshToken = 'glrt_valid_refresh_token'
    const encrypted = cipher.encrypt(token)
    const encryptedRefresh = cipher.encrypt(refreshToken)

    return IntegrationConnection.create({
      organizationId,
      userId,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: encryptedRefresh,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'fixture-user',
      scopesJson: ['read_user'],
      ...overrides,
    })
  }

  // 3.2: 无连接
  test('returns connection_required when no GitLab connection exists', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)

    const result = await resolver.resolve(Number(org.id), Number(owner.id))

    assert.equal(result.type, 'connection_required')
    if (result.type === 'connection_required') {
      assert.include(result.message, '尚未连接')
    }
  })

  // 3.2: 有连接成功解析
  test('returns connected with access token for valid connection', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await createGitlabConnection(Number(owner.id), Number(org.id))

    const result = await resolver.resolve(Number(org.id), Number(owner.id))

    assert.equal(result.type, 'connected')
    if (result.type === 'connected') {
      assert.equal(result.accessToken, 'glpat_valid_test_token')
      assert.exists(result.connection)
    }
  })

  // 3.2: 过期但可续期（有 refresh token）
  test('returns connected with renewed token when near expiry with refresh token', async ({
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    // 创建 token 距过期 60 秒（会触发续期）
    await createGitlabConnection(Number(owner.id), Number(org.id), {
      expiresAt: DateTime.now().plus({ seconds: 60 }),
    })

    // Fixture 续期返回 token 含 'refreshed' 前缀
    const result = await resolver.resolve(Number(org.id), Number(owner.id))

    assert.equal(result.type, 'connected')
    if (result.type === 'connected') {
      assert.include(result.accessToken, 'glpat_fixture_refreshed_')
    }
  })

  // 3.2: 过期且无 refresh token -> reauthorization_required
  test('returns reauthorization_required when expired without refresh token', async ({
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const encrypted = cipher.encrypt('glpat_expired_no_refresh')
    await IntegrationConnection.create({
      organizationId: org.id,
      userId: owner.id,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().minus({ days: 1 }),
      connectedAt: DateTime.now().minus({ days: 30 }),
      externalAccountId: '54321',
      externalAccountEmail: 'fixture-user',
      scopesJson: ['read_user'],
    })

    const result = await resolver.resolve(Number(org.id), Number(owner.id))

    assert.equal(result.type, 'reauthorization_required')
  })

  // 3.2: 撤销（status != connected）
  test('returns connection_required when connection is disconnected', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const encrypted = cipher.encrypt('glpat_disconnected')
    await IntegrationConnection.create({
      organizationId: org.id,
      userId: owner.id,
      provider: 'gitlab',
      status: 'disconnected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: null,
      connectedAt: DateTime.now().minus({ days: 10 }),
      disconnectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'fixture-user',
      scopesJson: ['read_user'],
    })

    const result = await resolver.resolve(Number(org.id), Number(owner.id))

    assert.equal(result.type, 'connection_required')
  })

  // 3.2: 跨用户隔离
  test('enforces cross-user isolation', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await createGitlabConnection(Number(owner.id), Number(org.id))

    // 用不同用户查
    const otherUser = await createUser()
    const result = await resolver.resolve(Number(org.id), Number(otherUser.id))

    assert.equal(result.type, 'connection_required')
  })

  // 3.2: 跨组织隔离
  test('enforces cross-organization isolation', async ({ assert }) => {
    const owner = await createUser()
    const org1 = await createOrganization(owner)
    await createGitlabConnection(Number(owner.id), Number(org1.id))

    // 用不同组织查（需要新组织）
    const org2 = await createOrganization(owner)
    const result = await resolver.resolve(Number(org2.id), Number(owner.id))

    assert.equal(result.type, 'connection_required')
  })

  // 3.2: 需重授权状态
  test('returns reauthorization_required when access token is missing', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await IntegrationConnection.create({
      organizationId: org.id,
      userId: owner.id,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: null,
      connectedAt: DateTime.now(),
      externalAccountId: '54321',
      externalAccountEmail: 'fixture-user',
      scopesJson: ['read_user'],
    })

    const result = await resolver.resolve(Number(org.id), Number(owner.id))

    assert.equal(result.type, 'reauthorization_required')
  })
})
