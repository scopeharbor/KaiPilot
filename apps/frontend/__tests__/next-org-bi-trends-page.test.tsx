/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.11 —— BI 趋势分析页面装配与
 * RBAC 测试（页面级真实路由 + envelope 网络层探针）。
 *
 * 覆盖：
 * - 授权（org:view / portfolio:view 任一）装配：工作台渲染且 GET 请求发出；
 * - 无两权限：受限横幅（data-permission-fallback）且数据接口零请求（RL-06）；
 * - 未选择组织：引导态渲染且零请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrgBiTrendsPage from '@/app/(next)/next/organization/bi/trends/page'
import { ensureLazyEchartsMock } from './helpers/echarts-mock'
import { FakeEChartsInstance } from './helpers/echarts-mock'

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      const instance = new FakeEChartsInstance(dom)
      bundle.instances.push(instance)
      return instance
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '项目总监',
      organizations:
        organizationId === null
          ? []
          : [
              {
                id: organizationId,
                name: '北极星研发部',
                slug: 'northstar',
                role: 'project_manager',
              },
            ],
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

function seriesFixture() {
  return [
    {
      metricKey: 'project_progress',
      metricVersion: 'bi-trend-v1',
      grain: 'week',
      window: 'last_12_weeks',
      points: [
        {
          bucketStart: '2026-07-06T00:00:00.000Z',
          bucketEnd: '2026-07-12T00:00:00.000Z',
          value: 10,
          missing: false,
          sampleCount: 4,
        },
      ],
      movingAverage: [null],
      direction: 'up',
      anomalies: [],
      freshness: { state: 'fresh', sourceCoverage: 1, freshnessHash: 'h', sources: [] },
      warnings: [],
      insights: [],
      evidenceRefs: [],
      sampleCount: 4,
    },
  ]
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrgBiTrendsPage />
    </QueryClientProvider>,
  )
}

function calls(): Array<{ path: string; init?: RequestInit }> {
  return envelopeMock.mock.calls.map((call) => ({
    path: String(call[0]),
    init: call[1] as RequestInit | undefined,
  }))
}

beforeEach(() => {
  envelopeMock.mockReset()
  ensureLazyEchartsMock().reset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OrgBiTrendsPage：装配与 RBAC', () => {
  test('org:view 授权：工作台装配、GET 请求发出、标题回显', async () => {
    setAuth(['org:view', 'portfolio:view'])
    envelopeMock.mockResolvedValue({
      data: seriesFixture(),
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      warnings: [],
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('BI 趋势分析')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-bi-trend-card]')).not.toBeNull())
    const requests = calls()
    expect(requests.length).toBeGreaterThanOrEqual(1)
    expect(requests[0]?.path).toContain('/organizations/1/bi/trends')
    expect(requests.every((request) => request.init?.method === undefined)).toBe(true)
  })

  test('无 org:view/portfolio:view：受限横幅渲染且数据接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看BI 趋势分析的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })

  test('未选择组织：引导态渲染且零请求', async () => {
    setAuth(['org:view'], null)
    renderPage()

    expect(document.querySelector('[data-org-guide-state]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })
})
