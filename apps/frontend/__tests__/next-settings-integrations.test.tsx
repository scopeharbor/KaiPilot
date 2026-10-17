/**
 * v3-ui-next-settings-admin-domains W5 · tasks 5.9 —— 集成工作区与回调镜像页测试
 * （spec「第三方集成与回调契约」：provider 状态列表 + 断开二次确认 + focusCategory 高亮 + callback 镜像页双态 + 权限守卫 0 请求）。
 *
 * 覆盖：
 * - provider 列表与连接状态渲染（GitHub、GitLab、Google Calendar 诚实披露文案）；
 * - 断开二次确认与提交：取消不发请求（0 请求）、确认后调用 `POST /integrations/:provider/disconnect` 并刷新；
 * - `focusCategory` 查询参数接收与类目高亮展示（`data-focus-category` 属性与聚焦徽标）；
 * - 镜像页 `/next/settings/integrations/callback` 参数渲染：
 *   - status=connected & provider=github：标题展示「GitHub 已连接」+ 返回链接；
 *   - status=preconnected：标题展示「OAuth 预连接已完成」；
 *   - status=error & errorCode=access_denied：标题展示「OAuth 预连接未完成」+ 错误码；
 * - 无 `integration:connect` 权限时渲染受限横幅，且底层接口 0 请求（RL-06）。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { IntegrationsWorkspace } from '@/components/next/settings/integrations/IntegrationsWorkspace'
import { IntegrationCallbackPage } from '@/app/(next)/next/settings/integrations/callback/page'
import type { IntegrationProviderDto } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const searchParamsMock = vi.hoisted(() => new URLSearchParams())
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/integrations',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock,
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    return (
      route(path, method) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[], organizationId: number = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'devops@example.com',
      fullName: '运维专家',
      organizations: [{ id: organizationId, name: '主研发组织', slug: 'main-org', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const mockProviders: IntegrationProviderDto[] = [
  {
    provider: 'github',
    displayName: 'GitHub',
    category: 'code_repository',
    description: '建立 GitHub 只读 OAuth 连接。',
    capabilities: ['github_readonly_oauth'],
    status: 'connected',
    configured: true,
    enabled: true,
    authMethods: ['oauth_redirect'],
    requiredEnvKeys: ['GITHUB_CLIENT_ID'],
    missingEnvKeys: [],
    scopes: ['read:user'],
    redirectUri: 'http://localhost:3000/settings/integrations/callback',
    setupGuide: [],
    note: '已连接至 GitHub 组织',
  },
  {
    provider: 'gitlab',
    displayName: 'GitLab',
    category: 'code_repository',
    description: '建立 GitLab 只读 OAuth 连接。',
    capabilities: ['gitlab_readonly_oauth'],
    status: 'ready',
    configured: true,
    enabled: true,
    authMethods: ['oauth_redirect'],
    requiredEnvKeys: ['GITLAB_CLIENT_ID'],
    missingEnvKeys: [],
    scopes: ['read_user'],
    redirectUri: 'http://localhost:3000/settings/integrations/callback',
    setupGuide: [],
    note: '可发起预连接授权',
  },
  {
    provider: 'google_calendar',
    displayName: 'Google Calendar',
    category: 'calendar',
    description: '准备 Google 日历 OAuth 入口。',
    capabilities: ['calendar_read'],
    status: 'disconnected',
    configured: true,
    enabled: true,
    authMethods: ['oauth_redirect'],
    requiredEnvKeys: [],
    missingEnvKeys: [],
    scopes: [],
    redirectUri: 'http://localhost:3000/settings/integrations/callback',
    setupGuide: [],
    note: '未连接',
  },
]

describe('IntegrationsWorkspace (v3-ui-next-settings-admin-domains W5 · 5.7/5.9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsMock.delete('focusCategory')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('渲染集成 provider 列表与连接状态及诚实披露', async () => {
    setAuth(['integration:connect'])
    installFetchRouter((path, method) => {
      if (path === '/integrations' && method === 'GET') {
        return jsonResponse(200, { data: mockProviders })
      }
      return null
    })

    renderWithClient(<IntegrationsWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('第三方集成')).toBeInTheDocument()
      expect(screen.getByText('GitHub')).toBeInTheDocument()
    })

    // 诚实披露文案
    expect(screen.getByTestId('honest-disclosure-banner')).toBeInTheDocument()
    expect(screen.getByText(/绝不交换用户 token/)).toBeInTheDocument()

    // 状态徽章渲染
    expect(screen.getByTestId('status-badge-github')).toHaveTextContent('已连接')
    expect(screen.getByTestId('status-badge-gitlab')).toHaveTextContent('可连接')
    expect(screen.getByTestId('status-badge-google_calendar')).toHaveTextContent('未连接')
  })

  test('断开连接二次确认流：取消零请求，确认调用 POST disconnect', async () => {
    setAuth(['integration:connect'])
    let providerList = [...mockProviders]

    const { records } = installFetchRouter((path, method) => {
      if (path === '/integrations' && method === 'GET') {
        return jsonResponse(200, { data: providerList })
      }
      if (path === '/integrations/github/disconnect' && method === 'POST') {
        providerList = providerList.map((p) =>
          p.provider === 'github' ? { ...p, status: 'disconnected' } : p,
        )
        return jsonResponse(200, { data: { success: true } })
      }
      return null
    })

    renderWithClient(<IntegrationsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('disconnect-github')).toBeInTheDocument()
    })

    // 点击断开连接弹出二次确认
    fireEvent.click(screen.getByTestId('disconnect-github'))
    expect(screen.getByTestId('disconnect-confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('断开第三方集成确认')).toBeInTheDocument()

    // 点击取消
    fireEvent.click(screen.getByTestId('cancel-disconnect-button'))
    expect(screen.queryByTestId('disconnect-confirm-dialog')).toBeNull()

    // 断言网络记录 0 写请求
    expect(records.filter((r) => r.method === 'POST').length).toBe(0)

    // 再次点击并确认断开
    fireEvent.click(screen.getByTestId('disconnect-github'))
    fireEvent.click(screen.getByTestId('confirm-disconnect-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('disconnect-confirm-dialog')).toBeNull()
    })

    // 校验断开请求发送
    const disconnectReq = records.find(
      (r) => r.method === 'POST' && r.url === '/integrations/github/disconnect',
    )
    expect(disconnectReq).toBeDefined()

    // 状态更新为未连接
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-github')).toHaveTextContent('未连接')
    })
  })

  test('接收 focusCategory 参数并高亮对应类目区块', async () => {
    setAuth(['integration:connect'])
    searchParamsMock.set('focusCategory', 'calendar')

    installFetchRouter((path, method) => {
      if (path === '/integrations' && method === 'GET') {
        return jsonResponse(200, { data: mockProviders })
      }
      return null
    })

    renderWithClient(<IntegrationsWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('日历连接')).toBeInTheDocument()
    })

    // 校验日历分组获得 focus 标记
    const calendarSection = screen.getByText('日历连接').closest('section')
    expect(calendarSection).toHaveAttribute('data-focus-category', 'calendar')
    expect(screen.getByText('聚焦类目')).toBeInTheDocument()
  })

  test('无 integration:connect 权限时渲染受限横幅且 0 请求（RL-06）', async () => {
    setAuth(['project:view'])

    const { records } = installFetchRouter(() => {
      return jsonResponse(200, { data: [] })
    })

    renderWithClient(<IntegrationsWorkspace />)

    expect(screen.getByText('没有第三方集成管理权限')).toBeInTheDocument()
    expect(screen.getByText(/需要 integration:connect 权限/)).toBeInTheDocument()

    // 验证网络监控：底层接口 0 请求
    const apiRequests = records.filter((r) => r.url.includes('/integrations'))
    expect(apiRequests.length).toBe(0)
  })
})

describe('IntegrationCallbackPage (v3-ui-next-settings-admin-domains W5 · 5.8/5.9)', () => {
  test('回调镜像页成功态（status=connected & provider=github）渲染', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'github',
          status: 'connected',
          message: 'GitHub OAuth 预连接已顺利建立。',
        }}
      />,
    )

    expect(screen.getByTestId('callback-title')).toHaveTextContent('GitHub 已连接')
    expect(screen.getByText('GitHub OAuth 预连接已顺利建立。')).toBeInTheDocument()
    expect(screen.getByText(/Provider 标识：/)).toBeInTheDocument()
    expect(screen.getByTestId('back-to-integrations-link')).toHaveAttribute(
      'href',
      '/next/settings/integrations',
    )
  })

  test('回调镜像页预连接完成态（status=preconnected）渲染', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'gitlab',
          status: 'preconnected',
          codeReceived: 'true',
        }}
      />,
    )

    expect(screen.getByTestId('callback-title')).toHaveTextContent('OAuth 预连接已完成')
    expect(screen.getByText('回调凭证：已成功接收校验码')).toBeInTheDocument()
  })

  test('回调镜像页错误态（status=error & errorCode=access_denied）渲染', () => {
    render(
      <IntegrationCallbackPage
        searchParams={{
          provider: 'google_calendar',
          status: 'error',
          errorCode: 'access_denied',
          message: '用户在 Google 授权页面拒绝了应用申请。',
        }}
      />,
    )

    expect(screen.getByTestId('callback-title')).toHaveTextContent('OAuth 预连接未完成')
    expect(screen.getByText('用户在 Google 授权页面拒绝了应用申请。')).toBeInTheDocument()
    expect(screen.getByText(/错误码：/)).toBeInTheDocument()
    expect(screen.getByText('access_denied')).toBeInTheDocument()
  })
})
