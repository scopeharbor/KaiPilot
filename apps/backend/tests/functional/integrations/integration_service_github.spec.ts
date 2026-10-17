/**
 * v2-5-github-readonly-oauth-connection —— IntegrationService GitHub 功能测试。
 *
 * 覆盖：authorize、callback、check、disconnect 的 GitHub 路由。
 * 所有测试使用 fixture/mock，不发起真实 GitHub API 调用。
 */

import { test } from '@japa/runner'
import IntegrationService, {
  type IntegrationActor,
} from '#services/integrations/integration_service'
import IntegrationConnection from '#models/integration_connection'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'

const configuredEnv = {
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
  GITHUB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/github/callback',
  GOOGLE_CALENDAR_CLIENT_ID: 'google-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
  GOOGLE_CALENDAR_REDIRECT_URI:
    'http://localhost:3333/api/v1/integrations/google_calendar/callback',
  GITLAB_CLIENT_ID: 'gitlab-client-id',
  GITLAB_CLIENT_SECRET: 'gitlab-client-secret',
  GITLAB_BASE_URL: 'https://gitlab.com',
  GITLAB_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/gitlab/callback',
}

const actor: IntegrationActor = { userId: 1, organizationId: 2 }

test.group('IntegrationService — GitHub', (group) => {
  useAuthDatabase(group)

  test('authorize returns GitHub authorization URL when configured', ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const result = service.authorize('github', actor)
    const url = new URL(result.authorizationUrl)

    assert.equal(result.provider, 'github')
    assert.equal(result.status, 'authorization_ready')
    assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), 'github-client-id')
    assert.equal(url.searchParams.get('scope'), 'read:user user:email')
    assert.isString(url.searchParams.get('state'))
  })

  test('authorize throws when github not configured', ({ assert }) => {
    // 模拟未配置 github 环境
    const service = new IntegrationService({
      GOOGLE_CALENDAR_CLIENT_ID: 'id',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
      GOOGLE_CALENDAR_REDIRECT_URI: 'uri',
    })
    assert.throws(() => service.authorize('github', actor), /尚未配置/)
  })

  test('authorize returns GitLab authorization URL when configured', ({ assert }) => {
    // v2-5-gitlab-readonly-oauth-connection 已实现 GitLab OAuth：配置齐备时
    // authorize('gitlab') 返回授权地址而非抛出预连接错误。
    const service = new IntegrationService(configuredEnv)
    const result = service.authorize('gitlab', actor)
    const url = new URL(result.authorizationUrl)

    assert.equal(result.provider, 'gitlab')
    assert.equal(result.status, 'authorization_ready')
    assert.isString(url.searchParams.get('state'))
  })

  test('callback handles GitHub success', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const localActor: IntegrationActor = {
      userId: Number(owner.id),
      organizationId: Number(org.id),
    }
    const service = new IntegrationService(configuredEnv)
    const auth = service.authorize('github', localActor)
    const state = new URL(auth.authorizationUrl).searchParams.get('state') ?? ''

    const result = await service.handleCallback('github', { code: 'test-code', state })

    assert.equal(result.provider, 'github')
    assert.equal(result.status, 'connected')
    assert.isTrue(result.codeReceived)
    assert.include(result.message, 'GitHub')
  })

  test('callback rejects GitHub error', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const result = await service.handleCallback('github', {
      code: undefined,
      state: undefined,
      error: 'access_denied',
    })
    assert.equal(result.status, 'error')
    assert.isFalse(result.codeReceived)
    assert.equal(result.errorCode, 'access_denied')
  })

  test('callback rejects missing code', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const auth = service.authorize('github', actor)
    const state = new URL(auth.authorizationUrl).searchParams.get('state') ?? ''

    await assert.rejects(() => service.handleCallback('github', { state }), /code/)
  })

  test('callback rejects invalid state', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    await assert.rejects(
      () => service.handleCallback('github', { code: 'code', state: 'bad.state' }),
      /state/,
    )
  })

  test('callback cross-org state creates connection for declared org in payload', async ({
    assert,
  }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)
    const service = new IntegrationService(configuredEnv)

    // ownerB 用自己的 state
    const authForB = service.authorize('github', {
      userId: Number(ownerB.id),
      organizationId: Number(orgB.id),
    })
    const crossOrgState = new URL(authForB.authorizationUrl).searchParams.get('state') ?? ''

    // 用 ownerB 的 state 但以 ownerA 的 actor 调用 callback
    // state 校验通过签名/过期, payload 声明 ownerB+orgB
    // handleGithubCallback 使用 state payload 中的 userId/orgId 做 upsert
    const result = await service.handleCallback('github', { code: 'code', state: crossOrgState })
    assert.equal(result.status, 'connected')

    // 验证连接属于 state 声明的 ownerB+orgB
    const conn = await IntegrationConnection.query()
      .where('user_id', ownerB.id)
      .where('organization_id', orgB.id)
      .where('provider', 'github')
      .first()
    assert.isNotNull(conn)
    assert.equal(conn!.status, 'connected')

    // ownerA+orgA 下不应有连接
    const connA = await IntegrationConnection.query()
      .where('user_id', ownerA.id)
      .where('organization_id', orgA.id)
      .where('provider', 'github')
      .first()
    assert.isNull(connA)
  })

  test('listProviders includes github with correct status when configured', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const providers = await service.listProviders(actor)
    const github = providers.find((p) => p.provider === 'github')
    assert.isDefined(github)
    assert.equal(github?.status, 'ready')
    assert.isTrue(github?.configured ?? false)
    assert.include(github?.capabilities ?? [], 'github_readonly_oauth')
  })

  test('listProviders shows github not_configured when env missing', async ({ assert }) => {
    const service = new IntegrationService({})
    const providers = await service.listProviders(actor)
    const github = providers.find((p) => p.provider === 'github')
    assert.isDefined(github)
    assert.isFalse(github?.configured ?? true)
    assert.isNotEmpty(github?.missingEnvKeys ?? [])
  })

  test('getProvider returns github config', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const github = await service.getProvider('github', actor)
    assert.equal(github?.provider, 'github')
    assert.equal(github?.displayName, 'GitHub')
  })

  test('check throws not_configured when no GitHub connection', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    await assert.rejects(() => service.check('github', actor), /未连接/)
  })

  test('disconnect falls back for non-GitHub code repos', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const result = await service.disconnectForActor('gitlab', actor)
    assert.equal(result.status, 'disconnected')
  })
})
