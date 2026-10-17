/**
 * v3-ui-next-batch4-reports-change-queue W2 · tasks 2.2
 * PMO 组合报表镜头渲染与指标聚合测试。
 *
 * 覆盖：
 * - 工作台首屏加载与骨架屏回显（aria-busy）；
 * - 项目多选过滤时指标动态重算（区块内项目卡片数量随过滤变化）；
 * - 点击项目卡片下钻调用路由跳转 `/next/projects/:id/reports`；
 * - 纯只读零写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoReportsLens } from '@/components/next/pmo/reports/PmoReportsLens'
import { useAuthStore } from '@/stores/auth-store'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo/reports',
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

const MOCK_PROJECTS = [
  {
    projectId: 201,
    projectName: '天权全域监控系统',
    projectStatus: 'in_progress',
    healthStatus: 'healthy',
    progressPercent: 88,
    overdueTaskCount: 0,
    soonDueTaskCount: 2,
    memberCount: 8,
    trafficLightColor: 'green',
    warnings: [],
  },
  {
    projectId: 202,
    projectName: '仓储物流调度中台',
    projectStatus: 'in_progress',
    healthStatus: 'at_risk',
    progressPercent: 54,
    overdueTaskCount: 2,
    soonDueTaskCount: 5,
    memberCount: 12,
    trafficLightColor: 'yellow',
    warnings: [],
  },
]

const MOCK_SUMMARY = {
  meta: {
    calculatedAt: '2026-09-12T10:00:00Z',
    metricVersion: '1.0',
    organizationId: 1,
    actorId: 1,
    visibleProjectCount: 2,
    totalProjectCount: 2,
  },
  kpis: [],
  trafficLight: {
    available: true,
    forbidden: false,
    greenCount: 1,
    yellowCount: 1,
    redCount: 0,
    grayCount: 0,
    warnings: [],
  },
  freshness: [],
  warnings: [],
}

describe('PMO 组合报表镜头 (PmoReportsLens · W2 tasks 2.1/2.2)', () => {
  let queryClient: QueryClient
  const recordedRequests: Array<{ url: string; method: string }> = []

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    recordedRequests.length = 0
    navMock.push.mockClear()

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pmo@example.com',
        fullName: 'PMO 主管',
        organizations: [{ id: 1, name: '北极星研发中心', slug: 'northstar', role: 'owner' }],
      },
      accessToken: 'test-token',
      refreshToken: null,
      permissions: ['portfolio:view'],
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
      const url = rawUrl.replace(API_PREFIX, '')
      const method = (init?.method ?? 'GET').toUpperCase()
      recordedRequests.push({ url, method })

      if (url.startsWith('/pmo/portfolio-dashboard/projects')) {
        return jsonResponse(200, {
          data: MOCK_PROJECTS,
          meta: { page: 1, perPage: 100, total: 2, totalPages: 1 },
        })
      }
      if (url.startsWith('/pmo/portfolio-dashboard')) {
        return jsonResponse(200, { data: MOCK_SUMMARY })
      }
      return jsonResponse(404, {})
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderLens() {
    return render(
      <QueryClientProvider client={queryClient}>
        <PmoReportsLens />
      </QueryClientProvider>,
    )
  }

  test('1. 首屏加载展示骨架屏（aria-busy），随后渲染四大态势区块', async () => {
    const { container } = renderLens()

    expect(container.querySelector('[data-pmo-reports-lens][aria-busy="true"]')).not.toBeNull()

    await waitFor(() => {
      expect(screen.getByText('PMO 组合报表镜头')).toBeInTheDocument()
    })
    expect(screen.getByText('组合交付与健康透视')).toBeInTheDocument()
    expect(screen.getByText('工期偏差与里程碑达成')).toBeInTheDocument()
    expect(screen.getByText('跨项目资源负荷分布')).toBeInTheDocument()
    expect(screen.getByText('变更冲击与波动度大盘')).toBeInTheDocument()
  })

  test('2. 项目多选过滤后指标动态重算，仅保留选中项目', async () => {
    renderLens()

    await waitFor(() => {
      expect(document.querySelector('[data-reports-project-filter-item="201"]')).not.toBeNull()
    })

    expect(document.querySelector('[data-project-health-item="202"]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-reports-project-filter-item="201"]')!)

    expect(screen.getByText('重置项目 (1)')).toBeInTheDocument()
    expect(document.querySelector('[data-project-health-item="201"]')).not.toBeNull()
    expect(document.querySelector('[data-project-health-item="202"]')).toBeNull()

    fireEvent.click(screen.getByText('重置项目 (1)'))
    expect(document.querySelector('[data-project-health-item="202"]')).not.toBeNull()
  })

  test('3. 点击项目下钻调用路由跳转至单项目报表中心', async () => {
    renderLens()

    await waitFor(() => {
      expect(document.querySelector('[data-project-health-item="201"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-project-health-item="201"]')!)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/201/reports')
  })

  test('4. 纯只读浏览全流程零写网络请求 (RL-01)', async () => {
    renderLens()

    await waitFor(() => {
      expect(screen.getByText('PMO 组合报表镜头')).toBeInTheDocument()
    })

    const writes = recordedRequests.filter((r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
    )
    expect(writes).toHaveLength(0)
  })
})
