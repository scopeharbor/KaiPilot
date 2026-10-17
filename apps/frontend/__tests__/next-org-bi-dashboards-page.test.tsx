/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.5 —— BI 仪表盘页面装配与
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
import OrgBiDashboardsPage from '@/app/(next)/next/organization/bi/dashboards/page'

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrgBiDashboardsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  envelopeMock.mockReset()
  envelopeMock.mockImplementation(async (rawPath: string) => {
    const path = rawPath.split('?')[0] ?? ''
    if (path.endsWith('/registry')) {
      return { data: [] }
    }
    if (path.endsWith('/current')) {
      return {
        data: {
          dashboardId: 5,
          organizationId: 1,
          scope: 'organization_shared',
          ownerActorId: null,
          name: '系统默认 BI 看板',
          version: 1,
          definitionHash: 'h',
          snapshotHash: 's',
          layout: { columns: 2, density: 'comfortable' },
          widgets: [],
          globalFilters: [],
          timeWindow: { mode: 'last_n_days', days: 30 },
          freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
          isDefault: true,
          isArchived: false,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      }
    }
    if (path.endsWith('/bi/dashboards')) {
      return { data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 0 } }
    }
    return { data: null }
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OrgBiDashboardsPage：装配与 RBAC', () => {
  test('org:view 授权：工作台装配、GET 请求发出、标题回显', async () => {
    setAuth(['org:view', 'portfolio:view'])
    renderPage()

    await waitFor(() => expect(screen.getByText('BI 仪表盘')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-bi-dash-workspace]')).not.toBeNull())
    const requests = envelopeMock.mock.calls.map((call) => ({
      path: String(call[0]).split('?')[0] ?? '',
      init: call[1] as RequestInit | undefined,
    }))
    expect(requests.length).toBeGreaterThanOrEqual(3)
    expect(
      requests.every((request) => request.path.startsWith('/organizations/1/bi/dashboards')),
    ).toBe(true)
    expect(requests.every((request) => request.init?.method === undefined)).toBe(true)
  })

  test('无 org:view/portfolio:view：受限横幅渲染且数据接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看BI 仪表盘的权限')).toBeInTheDocument()
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
