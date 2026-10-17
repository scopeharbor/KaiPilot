/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.8 —— BI 风险热力图页面装配与
 * RBAC 测试（页面级真实路由 + envelope 网络层探针）。
 *
 * 覆盖：
 * - 授权（org:view / portfolio:view 任一）装配：工作台渲染且 GET 请求发出；
 * - 无两权限：受限横幅（data-permission-fallback）且数据接口零请求（RL-06）；
 * - 未选择组织：引导态渲染且零请求；
 * - PROJECT_MANAGER（仅 portfolio:view）经任一集合守卫放行（design 锚点 §1 口径）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrgBiRiskHeatmapPage from '@/app/(next)/next/organization/bi/risk-heatmap/page'
import type { BiRiskHeatmapCell } from '@aiproj/types'

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '项目总监',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

function cellsFixture(): BiRiskHeatmapCell[] {
  return [
    {
      rowKey: 'proj-42',
      rowLabel: '开项核心引擎',
      columnKey: 'critical',
      columnLabel: '严重',
      score: 0.92,
      riskLevel: 'critical',
      count: 3,
      delta: null,
      confidence: 0.9,
      contributors: [],
      redactionState: 'none',
      warnings: [],
      evidenceRefs: [],
      sampleCount: 12,
      drilldownTargets: [],
    },
  ]
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrgBiRiskHeatmapPage />
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
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OrgBiRiskHeatmapPage：装配与 RBAC（spec 场景「组织成员查看风险热力矩阵并按色阶理解风险等级」）', () => {
  test('org:view 授权：工作台装配、GET 请求发出、标题回显', async () => {
    setAuth(['org:view', 'portfolio:view'])
    envelopeMock.mockResolvedValue({
      data: cellsFixture(),
      meta: {
        organizationId: 1,
        calculatedAt: '2026-09-10T08:00:00.000Z',
        metricVersion: 'bi-risk-heatmap-v1',
        page: 1,
        perPage: 50,
        total: 1,
        totalPages: 1,
      },
      warnings: [],
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('BI 风险热力图')).toBeInTheDocument())
    expect(screen.getByText(/组织风险热力矩阵/)).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-grid]')).not.toBeNull())
    const requests = calls()
    expect(requests.length).toBeGreaterThanOrEqual(1)
    expect(requests[0]?.path).toContain('/organizations/1/bi/risk-heatmap')
    expect(requests.every((request) => request.init?.method === undefined)).toBe(true)
  })

  test('PROJECT_MANAGER（仅 portfolio:view）：经任一集合守卫放行并可加载数据', async () => {
    setAuth(['portfolio:view'])
    envelopeMock.mockResolvedValue({
      data: cellsFixture(),
      meta: {
        organizationId: 1,
        calculatedAt: '2026-09-10T08:00:00.000Z',
        metricVersion: 'bi-risk-heatmap-v1',
        page: 1,
        perPage: 50,
        total: 1,
        totalPages: 1,
      },
      warnings: [],
    })
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-bi-heat-workspace]')).not.toBeNull())
    expect(envelopeMock).toHaveBeenCalled()
  })

  test('无 org:view/portfolio:view：受限横幅渲染且数据接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看BI 风险热力图的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })

  test('未选择组织：引导态渲染且零请求', async () => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目总监',
        organizations: [],
      },
      accessToken: null,
      refreshToken: null,
      permissions: ['org:view'],
      currentOrganizationId: null,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })
    renderPage()

    expect(document.querySelector('[data-org-guide-state]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })
})
