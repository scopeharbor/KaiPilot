/**
 * v3-ui-next-batch4-reports-change-queue W3 · tasks 3.8
 * PMO 全局变更镜头路由与工作台挂载集成测试。
 *
 * 覆盖：
 * - 直接访问 `/next/pmo/change-queue` 完整装配；
 * - 从 PMO 仪表盘子导航一键跳转；
 * - `portfolio:view` 权限门控守卫。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoChangeQueuePage from '@/app/(next)/next/pmo/change-queue/page'
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

describe('PMO 全局变更审批队列路由与工作台挂载 (W3 · tasks 3.7/3.8)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    navMock.push.mockClear()

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = rawUrl.replace(API_PREFIX, '')
      if (url.includes('/projects?')) {
        return jsonResponse(200, {
          data: [{ id: 301, organizationId: 1, name: '天权全域监控系统', code: 'CORE-01' }],
          meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      if (url.includes('/projects/301/change-requests')) {
        return jsonResponse(200, {
          data: [
            {
              id: 1,
              crCode: 'CR-2026-001',
              organizationId: 1,
              projectId: 301,
              title: '扩大范围变更',
              description: null,
              changeType: 'scope',
              status: 'submitted',
              priority: 'high',
              requesterId: 1,
              approverId: null,
              requestedBy: 1,
              reviewedBy: null,
              impactSummary: null,
              impactAnalysis: null,
              conditions: null,
              decisionReason: null,
              approvalComments: null,
              submittedAt: '2026-09-01T08:00:00.000Z',
              approvedAt: null,
              implementedAt: null,
              implementedBy: null,
              closedAt: null,
              closedBy: null,
              createdAt: '2026-09-01T08:00:00.000Z',
              updatedAt: '2026-09-01T08:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
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
              visibleProjectCount: 1,
              totalProjectCount: 1,
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

  test('1. 直接访问 /next/pmo/change-queue 完整装配（工具栏 + 表格镜头）', async () => {
    setAuth(['portfolio:view'])
    renderWithClient(<PmoChangeQueuePage />)

    await waitFor(() => {
      expect(screen.getByText('全局变更审批队列')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('CR-2026-001')).toBeInTheDocument()
    })
    expect(document.querySelector('[data-change-filter-toolbar]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-change-queue-lens]')).not.toBeNull()
  })

  test('2. 从 PMO 仪表盘子导航「变更队列」按钮一键跳转', async () => {
    setAuth(['portfolio:view'])
    renderWithClient(<PmoPortfolioOverviewPage />)

    await waitFor(() => {
      expect(document.querySelector('[data-pmo-nav-change-queue]')).not.toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '变更队列' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/pmo/change-queue')
  })

  test('3. 无 portfolio:view 权限时受限横幅拦截', () => {
    setAuth([])
    renderWithClient(<PmoChangeQueuePage />)

    expect(screen.getByText('你没有查看全局变更审批队列的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
  })

  test('4. 未选组织时渲染中性引导态 (RL-05)', () => {
    setAuth(['portfolio:view'], null)
    renderWithClient(<PmoChangeQueuePage />)

    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
  })
})
