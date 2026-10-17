import { test } from '@japa/runner'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import IntegrationConnection from '#models/integration_connection'
import GoogleOAuthService, {
  GoogleOAuthException,
} from '#services/integrations/google_oauth_service'
import IntegrationService from '#services/integrations/integration_service'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'

const googleEnv = {
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3333/api/v1/auth/google/callback',
  GOOGLE_CALENDAR_CLIENT_ID: 'google-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
  GOOGLE_CALENDAR_REDIRECT_URI:
    'http://localhost:3333/api/v1/integrations/google_calendar/callback',
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

test.group('Google OAuth real connection', (group) => {
  useAuthDatabase(group)

  test('Google service builds login URL and exchanges code with token endpoint', async ({
    assert,
  }) => {
    const calls: string[] = []
    const fetchMock = async (input: unknown) => {
      calls.push(String(input))
      return jsonResponse(200, {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'openid email',
        token_type: 'Bearer',
      })
    }
    const service = new GoogleOAuthService(googleEnv, fetchMock as typeof fetch)

    const authorization = service.loginAuthorizationUrl('/projects')
    const url = new URL(authorization.authorizationUrl)
    assert.equal(url.searchParams.get('client_id'), 'google-client-id')
    assert.equal(url.searchParams.get('redirect_uri'), googleEnv.GOOGLE_OAUTH_REDIRECT_URI)
    assert.include(url.searchParams.get('scope') ?? '', 'openid')
    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.equal(
      service.verifyState(url.searchParams.get('state') ?? '', 'login').next,
      '/projects',
    )

    const token = await service.exchangeCode('login', 'code')
    assert.equal(token.access_token, 'access-token')
    assert.include(calls, 'https://oauth2.googleapis.com/token')
  })

  test('Google login URL keeps next path in state and never appends it to prompt', ({ assert }) => {
    const service = new GoogleOAuthService(googleEnv)

    const authorization = service.loginAuthorizationUrl('/settings/ai-connections')
    const url = new URL(authorization.authorizationUrl)

    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.notInclude(url.searchParams.get('prompt') ?? '', '?next=')
    assert.equal(
      service.verifyState(url.searchParams.get('state') ?? '', 'login').next,
      '/settings/ai-connections',
    )
  })

  test('Google service can read client id and secret from client_secret JSON file', ({
    assert,
  }) => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'aiproj-google-oauth-'))
    try {
      const jsonPath = path.join(tmp, 'client_secret.json')
      writeFileSync(
        jsonPath,
        JSON.stringify({
          web: {
            client_id: 'json-client-id',
            client_secret: 'json-client-secret',
            redirect_uris: [
              'http://localhost:3333/api/v1/auth/google/callback',
              'http://localhost:3333/api/v1/integrations/google_calendar/callback',
            ],
          },
        }),
      )
      const service = new GoogleOAuthService({ GOOGLE_CLIENT_SECRET_JSON_PATH: jsonPath })

      const loginUrl = new URL(service.loginAuthorizationUrl('/projects').authorizationUrl)
      const calendarUrl = new URL(
        service.calendarAuthorizationUrl({ userId: 1, organizationId: 2 }).authorizationUrl,
      )

      assert.deepEqual(service.missingKeys('login'), [])
      assert.deepEqual(service.missingKeys('calendar'), [])
      assert.equal(loginUrl.searchParams.get('client_id'), 'json-client-id')
      assert.equal(
        loginUrl.searchParams.get('redirect_uri'),
        'http://localhost:3333/api/v1/auth/google/callback',
      )
      assert.equal(calendarUrl.searchParams.get('client_id'), 'json-client-id')
      assert.equal(
        calendarUrl.searchParams.get('redirect_uri'),
        'http://localhost:3333/api/v1/integrations/google_calendar/callback',
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('Google service reads userinfo and calendar list', async ({ assert }) => {
    const service = new GoogleOAuthService(googleEnv, (async (input: unknown) => {
      const url = String(input)
      if (url.includes('userinfo')) {
        return jsonResponse(200, {
          sub: 'google-sub',
          email: 'user@example.com',
          email_verified: true,
          name: 'Google User',
        })
      }
      return jsonResponse(200, {
        items: [{ summary: 'user@example.com', primary: true }, { summary: 'Team' }],
      })
    }) as typeof fetch)

    const profile = await service.userInfo('access-token')
    const calendars = await service.calendarList('access-token')

    assert.equal(profile.email, 'user@example.com')
    assert.equal(calendars.calendarCount, 2)
    assert.equal(calendars.primaryCalendarSummary, 'user@example.com')
  })

  test('Google token exchange times out with a typed failure before the edge timeout', async ({
    assert,
  }) => {
    const neverSettles = () => new Promise<Response>(() => {})
    const service = new GoogleOAuthService(googleEnv, neverSettles as typeof fetch, undefined, 10)

    try {
      await service.exchangeCode('login', 'one-time-code')
      assert.fail('expected token exchange to time out')
    } catch (error) {
      assert.instanceOf(error, GoogleOAuthException)
      assert.equal((error as GoogleOAuthException).code, 'token_exchange_failed')
      assert.deepEqual((error as GoogleOAuthException).details, {
        reason: 'timeout',
        endpoint: 'token',
      })
    }
  })

  test('Google userinfo times out with a typed API failure before the edge timeout', async ({
    assert,
  }) => {
    const neverSettles = () => new Promise<Response>(() => {})
    const service = new GoogleOAuthService(googleEnv, neverSettles as typeof fetch, undefined, 10)

    try {
      await service.userInfo('access-token')
      assert.fail('expected userinfo request to time out')
    } catch (error) {
      assert.instanceOf(error, GoogleOAuthException)
      assert.equal((error as GoogleOAuthException).code, 'google_api_error')
      assert.deepEqual((error as GoogleOAuthException).details, {
        reason: 'timeout',
        endpoint: 'userinfo',
      })
    }
  })

  test('IntegrationService stores Google Calendar tokens and reports connected status', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const fakeGoogle = {
      missingKeys: () => [],
      calendarAuthorizationUrl: () => ({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        stateExpiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
      verifyState: () => ({
        flow: 'calendar',
        userId: Number(user.id),
        organizationId: Number(org.id),
        nonce: 'n',
        expiresAt: Date.now() + 60000,
      }),
      exchangeCode: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'openid email https://www.googleapis.com/auth/calendar.events',
        token_type: 'Bearer',
      }),
      userInfo: async () => ({
        sub: 'google-sub',
        email: 'user@example.com',
        email_verified: true,
      }),
      encryptToken: (value: string) => `enc:${value}`,
      decryptToken: (value: string) => value.replace(/^enc:/, ''),
      calendarList: async () => ({ calendarCount: 1, primaryCalendarSummary: 'user@example.com' }),
      refreshAccessToken: async () => 'access-token',
    }
    const service = new IntegrationService(googleEnv, fakeGoogle as unknown as GoogleOAuthService)

    const callback = await service.handleCallback('google_calendar', {
      code: 'code',
      state: 'signed-state',
    })
    const providers = await service.listProviders({
      userId: Number(user.id),
      organizationId: Number(org.id),
    })
    const connection = await IntegrationConnection.firstOrFail()

    assert.equal(callback.status, 'connected')
    assert.equal(connection.status, 'connected')
    assert.equal(connection.accessTokenEncrypted, 'enc:access-token')
    assert.equal(connection.refreshTokenEncrypted, 'enc:refresh-token')
    assert.equal(
      providers.find((provider) => provider.provider === 'google_calendar')?.status,
      'connected',
    )
  })

  test('IntegrationService keeps Google Calendar interfaces and returns friendly read-pending message', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const fakeGoogle = {
      missingKeys: () => [],
      calendarAuthorizationUrl: () => ({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        stateExpiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
      verifyState: () => ({
        flow: 'calendar',
        userId: Number(user.id),
        organizationId: Number(org.id),
        nonce: 'n',
        expiresAt: Date.now() + 60000,
      }),
      exchangeCode: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'openid email profile',
        token_type: 'Bearer',
      }),
      userInfo: async () => ({
        sub: 'google-sub',
        email: 'user@example.com',
        email_verified: true,
      }),
      encryptToken: (value: string) => `enc:${value}`,
      decryptToken: (value: string) => value.replace(/^enc:/, ''),
      calendarList: async () => {
        throw new Error('insufficient authentication scopes')
      },
      refreshAccessToken: async () => 'access-token',
    }
    const service = new IntegrationService(googleEnv, fakeGoogle as unknown as GoogleOAuthService)

    await service.handleCallback('google_calendar', { code: 'code', state: 'signed-state' })
    await assert.rejects(
      () =>
        service.check('google_calendar', {
          userId: Number(user.id),
          organizationId: Number(org.id),
        }),
      /目前还未读取到 Google 日历/,
    )

    const connection = await IntegrationConnection.firstOrFail()
    assert.equal(connection.status, 'connected')
  })
})
