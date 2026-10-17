import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { integrationsApi, integrationKeys } from '@/lib/api/integrations'
import { IntegrationsSettings } from '@/components/integrations/IntegrationsSettings'
import IntegrationCallbackPage from '@/app/(dashboard)/settings/integrations/callback/page'
import type { IntegrationProviderDto } from '@aiproj/types'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function provider(overrides: Partial<IntegrationProviderDto> = {}): IntegrationProviderDto {
  return {
    provider: 'google_calendar',
    displayName: 'Google Calendar',
    category: 'calendar',
    description: '连接 Google 日历',
    capabilities: ['calendar_read', 'calendar_write', 'qr_authorize'],
    status: 'not_configured',
    configured: false,
    enabled: true,
    authMethods: ['oauth_redirect', 'qr_code'],
    requiredEnvKeys: ['GOOGLE_CALENDAR_CLIENT_ID'],
    missingEnvKeys: ['GOOGLE_CALENDAR_CLIENT_ID'],
    scopes: ['calendar.events'],
    redirectUri: null,
    setupGuide: [{ title: '创建 OAuth 客户端', description: '打开 Google Cloud Console' }],
    note: '缺少 OAuth 应用配置',
    ...overrides,
  }
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const mockAuthState = vi.hoisted(() => ({
  isAuthenticated: true,
  accessToken: 'test-token',
  refreshToken: null,
  currentOrganizationId: 1,
  permissions: ['outgoing_webhook:manage'],
  hasPermission: (permission: string) => permission === 'outgoing_webhook:manage',
  setTokens: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState)
  useAuthStore.getState = () => mockAuthState
  return { useAuthStore, getAuthScopeRevision: () => 0 }
})

vi.mock('qrcode', () => ({
  default: {
    toDataURL: () => Promise.resolve('data:image/png;base64,test-qr'),
  },
  toDataURL: () => Promise.resolve('data:image/png;base64,test-qr'),
}))

describe('轻量日历/消息集成', () => {
  afterEach(() => vi.restoreAllMocks())

  test('API list 使用 /integrations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [] })))

    await integrationsApi.list()

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/integrations'),
      expect.anything(),
    )
  })

  test('API authorize 使用 provider 路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            provider: 'google_calendar',
            authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            expiresAt: '2026-07-15T00:00:00.000Z',
            stateExpiresAt: '2026-07-15T00:00:00.000Z',
            status: 'authorization_ready',
            message: 'ok',
          },
        }),
      ),
    )

    await integrationsApi.authorize('google_calendar')

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/integrations/google_calendar/authorize'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('query keys encode provider detail', () => {
    expect(integrationKeys.list()).toEqual(['integrations', 'list'])
    expect(integrationKeys.detail('slack')).toEqual(['integrations', 'slack'])
  })

  test('API check 使用 provider 检查路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            provider: 'google_calendar',
            status: 'connected',
            accountEmail: 'user@example.com',
            calendarCount: 1,
            primaryCalendarSummary: 'user@example.com',
            checkedAt: '2026-07-15T00:00:00.000Z',
          },
        }),
      ),
    )

    await integrationsApi.check('google_calendar')

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/integrations/google_calendar/check'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('settings page renders provider actions and missing configuration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [provider()] })))

    renderWithClient(<IntegrationsSettings focusCategory="calendar" />)

    expect(await screen.findByText('Google Calendar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /配置后连接/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /扫码/ })).toBeInTheDocument()
    expect(screen.getByText(/GOOGLE_CALENDAR_CLIENT_ID/)).toBeInTheDocument()
  })

  test('settings page opens QR dialog for configured provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/integrations/google_calendar/qr')) {
          return Promise.resolve(
            jsonResponse(200, {
              data: {
                provider: 'google_calendar',
                authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test',
                expiresAt: '2026-07-15T00:00:00.000Z',
                qrTitle: '扫码连接 Google Calendar',
                qrDescription: '二维码打开 OAuth 授权地址',
              },
            }),
          )
        }
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              provider({
                status: 'ready',
                configured: true,
                missingEnvKeys: [],
                note: 'OAuth 应用配置已就绪',
              }),
            ],
          }),
        )
      }),
    )

    renderWithClient(<IntegrationsSettings focusCategory="calendar" />)

    expect(await screen.findByText('Google Calendar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /扫码/ }))

    expect(await screen.findByText('扫码连接 Google Calendar')).toBeInTheDocument()
    expect(await screen.findByAltText('OAuth 授权二维码')).toBeInTheDocument()
  })

  test('callback page explains preconnected state without claiming real sync', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'google_calendar',
          status: 'preconnected',
          message: 'OAuth 预连接已完成校验；当前版本尚未启用 token 交换和真实同步。',
        }}
      />,
    )

    expect(screen.getByText('OAuth 预连接已完成')).toBeInTheDocument()
    expect(screen.getByText(/尚未启用 token 交换和真实同步/)).toBeInTheDocument()
    expect(screen.getByText('Provider：google_calendar')).toBeInTheDocument()
  })

  test('settings page renders connected Google account and check action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            provider({
              status: 'connected',
              configured: true,
              missingEnvKeys: [],
              connectedAccountEmail: 'user@example.com',
              connectedAt: '2026-07-15T00:00:00.000Z',
              lastCheckedAt: '2026-07-15T01:00:00.000Z',
            }),
          ],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings focusCategory="calendar" />)

    expect(await screen.findByText('已连接')).toBeInTheDocument()
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /检查/ })).toBeInTheDocument()
  })

  // -----------------------------------------------------------------------
  // v2-5-github-readonly-oauth-connection: GitHub 前端测试
  // -----------------------------------------------------------------------

  function githubProvider(overrides: Partial<IntegrationProviderDto> = {}): IntegrationProviderDto {
    return {
      provider: 'github',
      displayName: 'GitHub',
      category: 'code_repository',
      description: 'GitHub 只读 OAuth 连接。当前版本只建立加密连接和健康检查。',
      capabilities: [
        'task_external_link',
        'status_snapshot',
        'safe_open_url',
        'github_readonly_oauth',
      ],
      status: 'not_configured',
      configured: false,
      enabled: true,
      authMethods: ['oauth_redirect'],
      requiredEnvKeys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI'],
      missingEnvKeys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI'],
      scopes: ['read:user', 'user:email'],
      redirectUri: null,
      setupGuide: [
        { title: '创建 GitHub OAuth App', description: '打开 GitHub Developer Settings' },
      ],
      note: '缺少 OAuth 应用配置',
      ...overrides,
    }
  }

  test('settings page shows GitHub in code_repository section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [githubProvider()],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(await screen.findByText(/GITHUB_CLIENT_ID/)).toBeInTheDocument()
  })

  test('settings page shows GitHub connected status with login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            githubProvider({
              status: 'connected',
              configured: true,
              missingEnvKeys: [],
              connectedAccountLogin: 'fixture-user',
              connectedAccountEmail: 'fixture-user',
              lastCheckedAt: '2026-07-22T00:00:00.000Z',
            }),
          ],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('已连接')).toBeInTheDocument()
    expect(screen.getByText(/fixture-user/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /检查/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /断开/ })).toBeInTheDocument()
  })

  test('settings page shows GitHub not configured state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [githubProvider()],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('待配置')).toBeInTheDocument()
  })

  test('settings page shows GitHub needs reauth badge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            githubProvider({
              status: 'needs_reauth',
              configured: true,
              missingEnvKeys: [],
              lastError: 'token_invalid',
            }),
          ],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('需重连')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新授权/ })).toBeInTheDocument()
  })

  test('settings page shows GitHub check failed state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            githubProvider({
              status: 'check_failed',
              configured: true,
              missingEnvKeys: [],
              lastError: 'GitHub API rate limit exceeded',
            }),
          ],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('检查失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /检查/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /断开/ })).toBeInTheDocument()
  })

  test('settings page shows only-read badge for connected GitHub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            githubProvider({
              status: 'connected',
              configured: true,
              missingEnvKeys: [],
            }),
          ],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('只读')).toBeInTheDocument()
  })

  test('GitHub provider authMethods does not include qr_code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [
            githubProvider({
              status: 'ready',
              configured: true,
              missingEnvKeys: [],
            }),
          ],
        }),
      ),
    )

    renderWithClient(<IntegrationsSettings />)

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /扫码/ })).not.toBeInTheDocument()
  })

  test('callback page shows GitHub connected', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'github',
          status: 'connected',
          message: 'GitHub 已连接：fixture-user',
        }}
      />,
    )

    expect(screen.getByText('GitHub 已连接')).toBeInTheDocument()
  })

  test('callback page shows Google Calendar connected unchanged', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'google_calendar',
          status: 'connected',
          message: 'Google Calendar 已连接：user@example.com',
        }}
      />,
    )

    expect(screen.getByText('Google Calendar 已连接')).toBeInTheDocument()
  })

  test('callback page shows error state with GitHub errorCode', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'github',
          status: 'error',
          errorCode: 'access_denied',
          message: '用户拒绝授权',
        }}
      />,
    )

    expect(screen.getByText('OAuth 预连接未完成')).toBeInTheDocument()
    expect(screen.getByText((t) => t.includes('access_denied'))).toBeInTheDocument()
  })

  test('GitHub API authorize returns valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            provider: 'github',
            authorizationUrl: 'https://github.com/login/oauth/authorize?state=test',
            expiresAt: '2026-07-22T00:00:00.000Z',
            stateExpiresAt: '2026-07-22T00:00:00.000Z',
            status: 'authorization_ready',
            message: '已生成 GitHub 授权地址',
          },
        }),
      ),
    )

    const result = await integrationsApi.authorize('github')
    expect(result.provider).toBe('github')
    expect(result.status).toBe('authorization_ready')
    expect(result.authorizationUrl).toContain('github.com')
  })

  test('GitHub API check returns low-sensitive fields only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: {
            provider: 'github',
            status: 'connected',
            accountEmail: null,
            accountLogin: 'fixture-user',
            scopeSummary: 'read:user, user:email',
            calendarCount: null,
            primaryCalendarSummary: null,
            checkedAt: '2026-07-22T00:00:00.000Z',
          },
        }),
      ),
    )

    const result = await integrationsApi.check('github')
    expect(result.provider).toBe('github')
    expect(result.status).toBe('connected')
    expect(result.accountLogin).toBe('fixture-user')
  })
})

// -----------------------------------------------------------------------
// v2-5-gitlab-readonly-oauth-connection: GitLab 前端测试
// -----------------------------------------------------------------------

function gitlabProvider(overrides: Partial<IntegrationProviderDto> = {}): IntegrationProviderDto {
  return {
    provider: 'gitlab',
    displayName: 'GitLab',
    category: 'code_repository',
    description: 'GitLab 只读 OAuth 连接。自托管 base URL 由服务端环境变量配置。',
    capabilities: [
      'task_external_link',
      'status_snapshot',
      'safe_open_url',
      'gitlab_readonly_oauth',
    ],
    status: 'not_configured',
    configured: false,
    enabled: true,
    authMethods: ['oauth_redirect'],
    requiredEnvKeys: ['GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'GITLAB_REDIRECT_URI'],
    missingEnvKeys: ['GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'GITLAB_REDIRECT_URI'],
    scopes: ['read_user'],
    redirectUri: null,
    setupGuide: [
      { title: '创建 GitLab 应用', description: '打开 GitLab User Settings > Applications' },
    ],
    note: '缺少 OAuth 应用配置',
    ...overrides,
  }
}

test('settings page shows GitLab in code_repository section', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [gitlabProvider()],
      }),
    ),
  )

  renderWithClient(<IntegrationsSettings />)

  expect(await screen.findByText('GitLab')).toBeInTheDocument()
  expect(await screen.findByText('待配置')).toBeInTheDocument()
  expect(await screen.findByText(/GITLAB_CLIENT_ID/)).toBeInTheDocument()
})

test('settings page shows GitLab connected status with login', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          gitlabProvider({
            status: 'connected',
            configured: true,
            missingEnvKeys: [],
            connectedAccountLogin: 'gitlab-user',
            connectedAccountEmail: 'gitlab-user',
            lastCheckedAt: '2026-07-22T00:00:00.000Z',
          }),
        ],
      }),
    ),
  )

  renderWithClient(<IntegrationsSettings />)

  expect(await screen.findByText('已连接')).toBeInTheDocument()
  expect(screen.getByText(/gitlab-user/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /检查/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /断开/ })).toBeInTheDocument()
})

test('settings page shows GitLab needs reauth badge', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          gitlabProvider({
            status: 'needs_reauth',
            configured: true,
            missingEnvKeys: [],
            lastError: 'token_invalid',
          }),
        ],
      }),
    ),
  )

  renderWithClient(<IntegrationsSettings />)

  expect(await screen.findByText('需重连')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /重新授权/ })).toBeInTheDocument()
})

test('settings page shows GitLab check failed state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          gitlabProvider({
            status: 'check_failed',
            configured: true,
            missingEnvKeys: [],
            lastError: 'GitLab API rate limit exceeded',
          }),
        ],
      }),
    ),
  )

  renderWithClient(<IntegrationsSettings />)

  expect(await screen.findByText('检查失败')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /检查/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /断开/ })).toBeInTheDocument()
})

test('settings page shows read-only badge for connected GitLab', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          gitlabProvider({
            status: 'connected',
            configured: true,
            missingEnvKeys: [],
          }),
        ],
      }),
    ),
  )

  renderWithClient(<IntegrationsSettings />)

  expect(await screen.findByText('只读')).toBeInTheDocument()
})

test('callback page shows GitLab connected', () => {
  render(
    <IntegrationCallbackPage
      searchParams={{
        provider: 'gitlab',
        status: 'connected',
        message: 'GitLab 已连接：gitlab-user',
      }}
    />,
  )

  expect(screen.getByText('GitLab 已连接')).toBeInTheDocument()
})

test('GitLab API authorize returns valid response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          provider: 'gitlab',
          authorizationUrl: 'https://gitlab.example.com/oauth/authorize?state=test',
          expiresAt: '2026-07-22T00:00:00.000Z',
          stateExpiresAt: '2026-07-22T00:00:00.000Z',
          status: 'authorization_ready',
          message: '已生成 GitLab 授权地址',
        },
      }),
    ),
  )

  const result = await integrationsApi.authorize('gitlab')
  expect(result.provider).toBe('gitlab')
  expect(result.status).toBe('authorization_ready')
  expect(result.authorizationUrl).toContain('gitlab')
})

test('GitLab API check returns low-sensitive fields only', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          provider: 'gitlab',
          status: 'connected',
          accountEmail: null,
          accountLogin: 'gitlab-user',
          scopeSummary: 'read_user',
          calendarCount: null,
          primaryCalendarSummary: null,
          checkedAt: '2026-07-22T00:00:00.000Z',
        },
      }),
    ),
  )

  const result = await integrationsApi.check('gitlab')
  expect(result.provider).toBe('gitlab')
  expect(result.status).toBe('connected')
  expect(result.accountLogin).toBe('gitlab-user')
})
