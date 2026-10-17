import { afterEach, describe, expect, test, vi } from 'vitest'
import { authApi, googleErrorMessage, googlePreflightMessage } from '@/lib/api/auth'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

describe('lib/api/auth', () => {
  afterEach(() => vi.restoreAllMocks())

  test('登录使用 Adonis Auth API 并返回 data 会话', async () => {
    const session = {
      user: { id: 1, email: 'admin@aiproj.local', fullName: '管理员', organizations: [] },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: session }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      authApi.login({ email: 'admin@aiproj.local', password: 'password123' }),
    ).resolves.toEqual(session)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@aiproj.local',
          password: 'password123',
        }),
      }),
    )
  })

  test('登录失败保留后端统一错误结构', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' },
        }),
      ),
    )
    await expect(
      authApi.login({ email: 'missing@example.com', password: 'Password123' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
  })

  test('Google 登录配置读取授权地址', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            configured: true,
            missingEnvKeys: [],
            authorizationUrl:
              'http://localhost:3333/api/v1/auth/google/authorize?next=%2Fdashboard',
          },
        }),
      ),
    )

    await expect(authApi.googleConfig('/dashboard')).resolves.toMatchObject({
      configured: true,
      authorizationUrl: expect.stringContaining('/auth/google/authorize'),
    })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/auth/google/config?next=%2Fdashboard'),
    )
  })

  test('Google 登录配置透传 preflight 状态（v3-docker-google-oauth-runtime-wiring）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            configured: false,
            missingEnvKeys: ['GOOGLE_OAUTH_CLIENT_ID'],
            authorizationUrl: null,
            preflight: { status: 'missing_file' },
          },
        }),
      ),
    )
    const config = await authApi.googleConfig('/')
    expect(config.preflight?.status).toBe('missing_file')
  })

  test('googlePreflightMessage 为部署人员提供可操作中文提示且不含秘密', () => {
    const cases: Array<[string, string | null]> = [
      ['configured', null],
      ['disabled', null],
      ['missing_file', 'AIPROJ_GOOGLE_OAUTH_SECRET_FILE'],
      ['unreadable_file', '权限'],
      ['invalid_json', 'JSON'],
      ['invalid_client_shape', 'client_secret'],
      ['redirect_not_configured', 'Google Console'],
    ]
    for (const [status, expectedSubstring] of cases) {
      const message = googlePreflightMessage(status as Parameters<typeof googlePreflightMessage>[0])
      if (expectedSubstring === null) {
        expect(message).toBeNull()
      } else {
        expect(message).toContain(expectedSubstring)
      }
    }
  })

  test('googleErrorMessage 映射 typed code，未知 code 归一 null 不回显原文', () => {
    expect(googleErrorMessage('access_denied')).toContain('取消')
    expect(googleErrorMessage('invalid_state')).toContain('失效')
    expect(googleErrorMessage('token_exchange_failed')).toContain('稍后再试')
    expect(googleErrorMessage('google_api_error')).toContain('稍后再试')
    expect(googleErrorMessage('account_inactive')).toContain('禁用')
    expect(googleErrorMessage('not_configured')).toContain('未配置')
    expect(googleErrorMessage('google_login_failed')).toContain('失败')
    expect(googleErrorMessage(undefined)).toBeNull()
    expect(googleErrorMessage('totally-unknown')).toBeNull()
  })
})
