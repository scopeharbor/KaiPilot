import { test } from '@japa/runner'
import IntegrationService from '#services/integrations/integration_service'

const configuredEnv = {
  GOOGLE_CALENDAR_CLIENT_ID: 'google-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
  GOOGLE_CALENDAR_REDIRECT_URI:
    'http://localhost:3333/api/v1/integrations/google_calendar/callback',
  SLACK_CLIENT_ID: 'slack-client-id',
  SLACK_CLIENT_SECRET: 'slack-secret',
  SLACK_REDIRECT_URI: 'http://localhost:3333/api/v1/integrations/slack/callback',
}

test.group('IntegrationService', () => {
  test('lists providers with missing configuration', async ({ assert }) => {
    const service = new IntegrationService({}, {
      missingKeys: () => [
        'GOOGLE_CALENDAR_CLIENT_ID',
        'GOOGLE_CALENDAR_CLIENT_SECRET',
        'GOOGLE_CALENDAR_REDIRECT_URI',
      ],
    } as any)
    const providers = await service.listProviders()

    assert.lengthOf(providers, 7)
    assert.equal(providers.find((p) => p.provider === 'google_calendar')?.status, 'not_configured')
    assert.includeMembers(
      providers.find((p) => p.provider === 'google_calendar')?.missingEnvKeys ?? [],
      [
        'GOOGLE_CALENDAR_CLIENT_ID',
        'GOOGLE_CALENDAR_CLIENT_SECRET',
        'GOOGLE_CALENDAR_REDIRECT_URI',
      ],
    )
  })

  test('generates Google Calendar OAuth URL when configured', ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const result = service.authorize('google_calendar', { userId: 1, organizationId: 2 })
    const url = new URL(result.authorizationUrl)

    assert.equal(result.provider, 'google_calendar')
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(url.searchParams.get('client_id'), 'google-client-id')
    assert.equal(url.searchParams.get('redirect_uri'), configuredEnv.GOOGLE_CALENDAR_REDIRECT_URI)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.isString(url.searchParams.get('state'))
  })

  test('QR payload reuses OAuth authorization URL', ({ assert }) => {
    const service = new IntegrationService(configuredEnv)
    const auth = service.authorize('google_calendar', { userId: 1, organizationId: 2 })
    const qr = service.qr('google_calendar', { userId: 1, organizationId: 2 })

    assert.equal(qr.provider, 'google_calendar')
    assert.include(qr.authorizationUrl, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(new URL(qr.authorizationUrl).searchParams.get('client_id'), 'google-client-id')
    assert.notEqual(qr.authorizationUrl, auth.authorizationUrl)
  })

  test('non-Google callback validates signed state and returns preconnected result', async ({
    assert,
  }) => {
    const service = new IntegrationService(configuredEnv)
    const auth = service.authorize('slack', { userId: 1, organizationId: 2 })
    const state = new URL(auth.authorizationUrl).searchParams.get('state') ?? ''

    const result = await service.handleCallback('slack', { code: 'auth-code', state })

    assert.equal(result.status, 'preconnected')
    assert.isTrue(result.codeReceived)
  })

  test('invalid state is rejected', async ({ assert }) => {
    const service = new IntegrationService(configuredEnv)

    await assert.rejects(
      () => service.handleCallback('google_calendar', { code: 'auth-code', state: 'bad.state' }),
      /state/,
    )
  })
})
