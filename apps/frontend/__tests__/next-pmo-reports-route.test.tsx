/**
 * v3-ui-next-batch4-reports-change-queue W2 · tasks 2.8
 * PMO 报表镜头路由与子导航集成测试。
 *
 * 覆盖：
 * - 从 PMO 仪表盘点击「组合报表」平滑切入 `/next/pmo/reports`；
 * - 未授权用户受限横幅拦截（RL-06）；
 * - 未选组织中性引导态（RL-05）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoReportsPage from '@/app/(next)/next/pmo/reports/page'
import PmoPortfolioOverviewPage from '@/app/(next)/next/pmo/page'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pmo@example.com',
      fullName: 'PMO 主管',
      organizations:
        organizationId === null
          ? []
          : [{ id: 1, name: '北极星研发中心', slug: 'northstar', role: 'owner' }],
    },
    accessToken: 'test-token',
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

describe('PMO 报表镜头路由与子导航集成 (W2 · tasks 2.7/2.8)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    navMock.push.mockClear()

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = rawUrl.replace(API_PREFIX, '')
      if (url.startsWith('/pmo/portfolio-dashboard/projects')) {
        return jsonResponse(200, {
          data: [],
          meta: { page: 1, perPage: 100, total: 0, totalPages: 0 },
        })
      }
      if (url.startsWith('/pmo/portfolio-dashboard')) {
        return jsonResponse(200, {
          data: {
            meta: {
              calculatedAt: '2026-09-12T10:00:00Z',
              metricVersion: '1.0',
              organizationId: 1,
              actorId: 1,
              visibleProjectCount: 0,
              totalProjectCount: 0,
            },
            kpis: [],
            trafficLight: null,
            freshness: [],
            warnings: [],
          },
        })
      }
      return jsonResponse(404, {})
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithClient(children: React.ReactNode) {
    return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
  }

  test('1. PMO 仪表盘子导航「组合报表」按钮跳转到 /next/pmo/reports', async () => {
    setAuth(['portfolio:view'])
    renderWithClient(<PmoPortfolioOverviewPage />)

    await waitFor(() => {
      expect(document.querySelector('[data-pmo-nav-reports]')).not.toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '组合报表' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo/reports')
  })

  test('2. 未授权用户访问 /next/pmo/reports 呈现受限横幅', () => {
    setAuth([])
    renderWithClient(<PmoReportsPage />)

    expect(screen.getByText('你没有查看组合报表的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
  })

  test('3. 未选组织时渲染中性引导态 (RL-05)', () => {
    setAuth(['portfolio:view'], null)
    renderWithClient(<PmoReportsPage />)

    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
  })

  test('4. 已授权且已选组织时装配 PMO 组合报表镜头', async () => {
    setAuth(['portfolio:view'], 1)
    renderWithClient(<PmoReportsPage />)

    await waitFor(() => {
      expect(screen.getByText('PMO 组合报表镜头')).toBeInTheDocument()
    })
  })
})
