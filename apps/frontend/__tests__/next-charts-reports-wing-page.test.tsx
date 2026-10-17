/**
 * v3-ui-next-batch4-reports-change-queue W1 · tasks 1.7/1.8
 * 图表馆组织级报表分馆装配与 Tab 联动测试（/next/charts 页面）。
 *
 * 覆盖：
 * - 页面根据 `?tab=reports-wing` 默认激活组织报表分馆；
 * - 未选组织时的中性引导态；
 * - 从分馆卡片切入模板快照预览。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import GlobalChartsGalleryPage from '@/app/(next)/next/charts/page'
import { jsonResponse } from './helpers/chart-gallery-network'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ current: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/charts',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.current,
}))

describe('图表馆组织级报表分馆装配与 Tab 联动 (W1 · tasks 1.7/1.8)', () => {
  let queryClient: QueryClient
  const recordedRequests: Array<{ url: string; method: string }> = []

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    recordedRequests.length = 0
    navMock.push.mockClear()
    navMock.replace.mockClear()
    searchParamsMock.current = new URLSearchParams()

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目总监',
        organizations: [{ id: 1, name: '北极星研发中心', slug: 'northstar', role: 'owner' }],
      },
      accessToken: 'test-token',
      refreshToken: null,
      permissions: ['portfolio:view', 'report:view'],
      currentOrganizationId: 1,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      recordedRequests.push({ url: rawUrl, method })

      if (rawUrl.includes('/projects?')) {
        return jsonResponse(200, {
          data: [
            {
              id: 101,
              organizationId: 1,
              name: '开项核心引擎',
              code: 'CORE-01',
              description: null,
              category: null,
              status: 'active',
              priority: 'high',
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              budgetCents: null,
              currency: null,
              progressPercent: 45,
              healthStatus: 'healthy',
              settings: null,
              createdBy: 1,
              updatedBy: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, perPage: 24, totalPages: 1 },
        })
      }
      if (rawUrl.includes('/projects/101/tasks')) {
        return jsonResponse(200, { data: [] })
      }
      if (rawUrl.includes('/projects/101/milestones')) {
        return jsonResponse(200, { data: [] })
      }
      return jsonResponse(404, {})
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-immersion')
  })

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <GlobalChartsGalleryPage />
      </QueryClientProvider>,
    )
  }

  test('1. 默认 Tab 为图表全览，?tab=reports-wing 时默认激活组织报表分馆', async () => {
    searchParamsMock.current = new URLSearchParams('tab=reports-wing')
    renderPage()

    await waitFor(() => {
      expect(document.querySelector('[data-org-reports-gallery-wing]')).not.toBeNull()
    })

    const wingTab = document.querySelector('[data-charts-page-tab="reports-wing"]')
    expect(wingTab).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-org-reports-gallery-wing]')).not.toBeNull()
    expect(document.querySelector('[data-global-charts-projects]')).toBeNull()
  })

  test('2. 点击 Tab 切换到组织级报表分馆并可切回图表全览', async () => {
    renderPage()

    expect(document.querySelector('[data-charts-page-tab="charts"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(document.querySelector('[data-global-charts-projects]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-charts-page-tab="reports-wing"]')!)

    await waitFor(() => {
      expect(document.querySelector('[data-org-reports-gallery-wing]')).not.toBeNull()
    })
    expect(navMock.replace).toHaveBeenCalledWith('/next/charts?tab=reports-wing')

    fireEvent.click(document.querySelector('[data-charts-page-tab="charts"]')!)
    expect(document.querySelector('[data-global-charts-projects]')).not.toBeNull()
  })

  test('3. 未选择有效组织时，组织级报表分馆渲染中性引导态且零请求', async () => {
    useAuthStore.setState({ currentOrganizationId: null })
    searchParamsMock.current = new URLSearchParams('tab=reports-wing')
    renderPage()

    expect(screen.getByText('未选择有效组织')).toBeInTheDocument()
    expect(document.querySelector('[data-unselected-org-neutral]')).not.toBeNull()
    expect(recordedRequests).toHaveLength(0)
  })

  test('4. 从分馆卡片切入模板快照预览', async () => {
    searchParamsMock.current = new URLSearchParams('tab=reports-wing')
    renderPage()

    await waitFor(() => {
      expect(document.querySelector('[data-report-template-card="progress"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-report-template-card="progress"]')!)

    await waitFor(() => {
      expect(document.querySelector('[data-report-snapshot-panel]')).not.toBeNull()
    })
  })
})
