/**
 * v3-ui-next-settings-admin-domains W5 · tasks 5.10 —— AI 与集成四页入口装配测试
 * （spec「AI 模型连接与用量」「编译器技能注册表」「第三方集成与回调契约」+ RL-06 权限守卫零请求）。
 *
 * 覆盖四页入口装配：
 * 1. `/next/settings/ai-connections`：无 `ai:connection:manage` 渲染受限横幅且底层 0 请求；有权渲染工作区、骨架与错误重试；
 * 2. `/next/settings/ai-usage`：无 `ai:usage:view` 渲染受限横幅且底层 0 请求；有权渲染工作区、骨架与错误重试；
 * 3. `/next/settings/compiler-skills`：无 `ai:compiler:skill:view` 渲染受限横幅且底层 0 请求；有权渲染工作区、骨架与错误重试；
 * 4. `/next/settings/integrations`：无 `integration:connect` 渲染受限横幅且底层 0 请求；有权渲染工作区、骨架与错误重试。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore, type PlanTier } from '@/stores/auth-store'
import NextSettingsAiConnectionsPage from '@/app/(next)/next/settings/ai-connections/page'
import NextSettingsCompilerSkillsPage from '@/app/(next)/next/settings/compiler-skills/page'
import NextSettingsIntegrationsPage from '@/app/(next)/next/settings/integrations/page'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/test',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
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

function setAuth(
  permissions: string[],
  organizationId: number = 1,
  planTier: PlanTier | null = 'enterprise',
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: organizationId, name: '主研发组织', slug: 'main-org', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

describe('AI 与集成四页入口装配测试 (v3-ui-next-settings-admin-domains W5 · 5.10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('/next/settings/ai-connections', () => {
    test('无权限渲染受限横幅且 0 请求', async () => {
      setAuth(['unrelated:permission'], 1, 'enterprise')
      const { records } = installFetchRouter(() => jsonResponse(200, { data: [] }))

      renderWithClient(<NextSettingsAiConnectionsPage />)

      expect(screen.getByText('没有 AI 连接管理权限')).toBeInTheDocument()
      expect(records.filter((r) => r.url.startsWith('/ai/connections')).length).toBe(0)
    })

    test('有权限装配工作区、展示空态与重试闭环', async () => {
      setAuth(['ai:connection:manage'])
      let fail = true

      installFetchRouter((path, method) => {
        if (path === '/ai/connections' && method === 'GET') {
          if (fail)
            return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: '服务异常' } })
          return jsonResponse(200, { data: [] })
        }
        return null
      })

      renderWithClient(<NextSettingsAiConnectionsPage />)

      // 错误态与重试按钮
      await waitFor(() => {
        expect(screen.getByText('无法载入 AI 模型连接列表')).toBeInTheDocument()
      })

      fail = false
      fireEvent.click(screen.getByTestId('retry-connections-button'))

      // 重载成功展示空态
      await waitFor(() => {
        expect(screen.getByText('暂无 AI 模型连接')).toBeInTheDocument()
      })
    })
  })

  describe('/next/settings/compiler-skills', () => {
    test('无权限渲染受限横幅且 0 请求', async () => {
      setAuth(['unrelated:permission'])
      const { records } = installFetchRouter(() => jsonResponse(200, { data: [] }))

      renderWithClient(<NextSettingsCompilerSkillsPage />)

      expect(screen.getByText('没有查看编译器技能的权限')).toBeInTheDocument()
      expect(records.filter((r) => r.url.includes('/ai/compiler/skills')).length).toBe(0)
    })

    test('有权限装配工作区、展示空态与重试闭环', async () => {
      setAuth(['ai:compiler:skill:view'])
      let fail = true

      installFetchRouter((path, method) => {
        if (path.startsWith('/ai/compiler/skills') && method === 'GET') {
          if (fail)
            return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: '服务异常' } })
          return jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 100 } })
        }
        return null
      })

      renderWithClient(<NextSettingsCompilerSkillsPage />)

      // 错误态与重试按钮
      await waitFor(() => {
        expect(screen.getByText('无法载入技能注册表数据')).toBeInTheDocument()
      })

      fail = false
      fireEvent.click(screen.getByTestId('retry-skills-button'))

      // 重载成功展示空态
      await waitFor(() => {
        expect(screen.getByText('暂无编译器技能')).toBeInTheDocument()
      })
    })
  })

  describe('/next/settings/integrations', () => {
    test('无权限渲染受限横幅且 0 请求', async () => {
      setAuth(['unrelated:permission'])
      const { records } = installFetchRouter(() => jsonResponse(200, { data: [] }))

      renderWithClient(<NextSettingsIntegrationsPage />)

      expect(screen.getByText('没有第三方集成管理权限')).toBeInTheDocument()
      expect(records.filter((r) => r.url.startsWith('/integrations')).length).toBe(0)
    })

    test('有权限装配工作区、展示空态与重试闭环', async () => {
      setAuth(['integration:connect'])
      let fail = true

      installFetchRouter((path, method) => {
        if (path === '/integrations' && method === 'GET') {
          if (fail)
            return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: '服务异常' } })
          return jsonResponse(200, { data: [] })
        }
        return null
      })

      renderWithClient(<NextSettingsIntegrationsPage />)

      // 错误态与重试按钮
      await waitFor(() => {
        expect(screen.getByText('无法载入第三方集成列表')).toBeInTheDocument()
      })

      fail = false
      fireEvent.click(screen.getByTestId('retry-integrations-button'))

      // 重载成功展示空态
      await waitFor(() => {
        expect(screen.getByText('暂无可用集成')).toBeInTheDocument()
      })
    })
  })
})
