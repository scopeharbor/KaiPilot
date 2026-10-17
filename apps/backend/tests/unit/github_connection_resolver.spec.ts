import { test } from '@japa/runner'
import { GitHubConnectionResolver } from '#services/integrations/github_connection_resolver'
import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import { DateTime } from 'luxon'

test.group('GitHubConnectionResolver', (group) => {
  let resolver: GitHubConnectionResolver
  let cipher: IntegrationTokenCipher

  group.each.setup(async () => {
    cipher = new IntegrationTokenCipher()
    resolver = new GitHubConnectionResolver(cipher)
  })

  test('returns connection_required when no connection exists', async ({ assert }) => {
    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'connection_required')
    assert.include(result.message, '尚未连接')
  })

  test('returns connected with decrypted token for valid connection', async ({ assert }) => {
    const token = 'gho_valid_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
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

    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'connected')
    if (result.type === 'connected') {
      assert.equal(result.accessToken, token)
      assert.isDefined(result.connection)
    }
  })

  test('returns reauthorization_required for expired token', async ({ assert }) => {
    const token = 'gho_expired_test_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().minus({ days: 1 }),
      connectedAt: DateTime.now().minus({ days: 2 }),
      externalAccountId: '12345',
      externalAccountEmail: 'test@example.com',
      scopesJson: ['read:user', 'user:email'],
    })

    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'reauthorization_required')
    assert.include(result.message, '过期')
  })

  test('returns reauthorization_required for missing access token', async ({ assert }) => {
    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'test@example.com',
      scopesJson: ['read:user', 'user:email'],
    })

    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'reauthorization_required')
    assert.include(result.message, '不完整')
  })

  test('returns reauthorization_required for corrupted token', async ({ assert }) => {
    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: 'corrupted-token-data',
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'test@example.com',
      scopesJson: ['read:user', 'user:email'],
    })

    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'reauthorization_required')
    assert.include(result.message, '无法解密')
  })

  test('cross-user isolation: user cannot access another users connection', async ({ assert }) => {
    const token = 'gho_user1_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'user1@example.com',
      scopesJson: ['read:user', 'user:email'],
    })

    // user 2 should not access user 1's connection
    const result = await resolver.resolve(1, 2)
    assert.equal(result.type, 'connection_required')
  })

  test('cross-organization isolation: org cannot access another orgs connection', async ({
    assert,
  }) => {
    const token = 'gho_org1_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'org1@example.com',
      scopesJson: ['read:user', 'user:email'],
    })

    // org 2 should not access org 1's connection
    const result = await resolver.resolve(2, 1)
    assert.equal(result.type, 'connection_required')
  })

  test('ignores non-github providers', async ({ assert }) => {
    const token = 'gho_gitlab_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'gitlab',
      status: 'connected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'gitlab@example.com',
      scopesJson: ['read:user'],
    })

    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'connection_required')
  })

  test('ignores disconnected status', async ({ assert }) => {
    const token = 'gho_disconnected_token'
    const encrypted = cipher.encrypt(token)

    await IntegrationConnection.create({
      organizationId: 1,
      userId: 1,
      provider: 'github',
      status: 'disconnected',
      accessTokenEncrypted: encrypted,
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: '12345',
      externalAccountEmail: 'test@example.com',
      scopesJson: ['read:user', 'user:email'],
    })

    const result = await resolver.resolve(1, 1)
    assert.equal(result.type, 'connection_required')
  })
})
