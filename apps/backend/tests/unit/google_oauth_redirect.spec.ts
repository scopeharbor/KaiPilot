import { test } from '@japa/runner'
import AuthController from '#controllers/auth_controller'
import { GoogleOAuthException } from '#services/integrations/google_oauth_service'
import type { HttpContext } from '@adonisjs/core/http'

function makeRedirectContext(
  next = '/settings/ai-connections',
  query: Record<string, string> = {},
) {
  const headers = new Map<string, string>()
  const warnings: Array<Record<string, unknown>> = []
  let statusCode = 200
  let sentBody: unknown

  const response = {
    status(code: number) {
      statusCode = code
      return response
    },
    header(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
      return response
    },
    send(body: unknown) {
      sentBody = body
      return { statusCode, headers, body: sentBody }
    },
  }

  return {
    ctx: {
      request: {
        input(key: string) {
          return key === 'next' ? next : undefined
        },
        qs() {
          return query
        },
        id() {
          return 'request-id'
        },
        ip() {
          return '127.0.0.1'
        },
        header() {
          return undefined
        },
      },
      response,
      logger: {
        warn(data: Record<string, unknown>) {
          warnings.push(data)
        },
      },
    } as unknown as HttpContext,
    headers,
    statusCode: () => statusCode,
    sentBody: () => sentBody,
    warnings,
  }
}

test.group('Google OAuth redirects', () => {
  test('googleAuthorize writes exact Google authorization URL to Location header', async ({
    assert,
  }) => {
    const googleUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?prompt=consent&state=signed-state'
    const controller = new AuthController(
      {} as never,
      {
        loginAuthorizationUrl(next: string) {
          assert.equal(next, '/settings/ai-connections')
          return {
            authorizationUrl: googleUrl,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }
        },
      } as never,
      // AuthController 现在还注入 TwoFactorService；本 spec 只跑 Google 重定向分支，给空替身即可。
      {} as never,
    )
    const { ctx, headers, statusCode, sentBody } = makeRedirectContext()

    await controller.googleAuthorize(ctx)

    assert.equal(statusCode(), 302)
    assert.equal(headers.get('location'), googleUrl)
    assert.isNull(sentBody())
  })

  test('googleCallback converts token exchange failure to a safe login redirect', async ({
    assert,
  }) => {
    const controller = new AuthController(
      {} as never,
      {
        verifyState() {
          return { next: '/dashboard' }
        },
        async exchangeCode() {
          throw new GoogleOAuthException('token_exchange_failed', 'token exchange failed')
        },
      } as never,
      // AuthController 现在还注入 TwoFactorService；本 spec 只跑 Google 重定向分支，给空替身即可。
      {} as never,
    )
    const { ctx, headers, statusCode, sentBody, warnings } = makeRedirectContext('/dashboard', {
      code: 'sensitive-code',
      state: 'sensitive-state',
    })

    await controller.googleCallback(ctx)

    const location = new URL(headers.get('location') ?? '')
    assert.equal(statusCode(), 302)
    assert.equal(location.pathname, '/login')
    assert.equal(location.searchParams.get('google_error'), 'token_exchange_failed')
    assert.notInclude(location.toString(), 'sensitive-code')
    assert.notInclude(location.toString(), 'sensitive-state')
    assert.isNull(sentBody())
    assert.deepEqual(warnings, [
      {
        stage: 'token_exchange',
        errorCode: 'token_exchange_failed',
        requestId: 'request-id',
      },
    ])
  })
})
