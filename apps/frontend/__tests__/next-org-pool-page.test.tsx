/**
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.5 —— 组织资源池页面装配与 RBAC 测试。
 *
 * 覆盖（spec「组织资源池与资源缺口分析」+ RBAC 矩阵）：
 * - 授权（任一 org:view/portfolio:view/resource:view）：工作台装配 + 面包屑回显
 *   （…/resource-pool · 组织资源池）；
 * - 无任一准入权限：受限横幅（data-pool-permission-fallback）且业务请求零发出
 *   （RL-06，api client 零调用 + 全局 fetch 零记录）；
 * - 未选择组织：引导态（data-org-guide）且零请求；
 * - 具备 resource:view 单独权限亦正常装配（任一集合语义）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrganizationResourcePoolPage from '@/app/(next)/next/organization/resource-pool/page'
import type {
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolSummary,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-pool',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

// ---------------------------------------------------------------------------
// 数据层 mock（页面装配验证：授权态数据路径 / 受限态零调用）
// ---------------------------------------------------------------------------
const apiMock = vi.hoisted(() => ({
  summary: vi.fn(),
  resources: vi.fn(),
  skills: vi.fn(),
  capacity: vi.fn(),
  conflicts: vi.fn(),
  demandGaps: vi.fn(),
}))
vi.mock('@/lib/api/organization-resource-pool', () => ({
  organizationResourcePoolApi: apiMock,
  organizationResourcePoolKeys: {
    all: ['organization-resource-pool'],
    summary: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'summary', organizationId, query] as const,
    resources: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'resources', organizationId, query] as const,
    skills: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'skills', organizationId, query] as const,
    capacity: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'capacity', organizationId, query] as const,
    conflicts: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'conflicts', organizationId, query] as const,
    demandGaps: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'demandGaps', organizationId, query] as const,
  },
}))

// ---------------------------------------------------------------------------
// 会话 / 夹具 / 渲染
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'viewer@example.com',
      fullName: '资源观察员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: organizationId !== null,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeSummary(): OrganizationResourcePoolSummary {
  return {
    meta: {
      calculatedAt: '2026-09-01T08:00:00.000Z',
      metricVersion: 'organization-resource-pool.v1',
      organizationId: 1,
      actorId: 1,
      visibleProjectCount: 2,
      querySignatureHash: 'abc',
    },
    metrics: [
      {
        key: 'org_respool_total_resources',
        value: 3,
        unit: 'count',
        source: 'resource_registry',
        status: 'ok',
      },
      {
        key: 'org_respool_total_capacity_hours',
        value: 480,
        unit: 'hours',
        source: 'resource_registry',
        status: 'ok',
      },
      {
        key: 'org_respool_allocated_capacity_hours',
        value: 300,
        unit: 'hours',
        source: 'resource_allocation',
        status: 'ok',
      },
      {
        key: 'org_respool_remaining_capacity_hours',
        value: 180,
        unit: 'hours',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_avg_utilization_percent',
        value: 62.5,
        unit: 'percent',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_overloaded_resources',
        value: 0,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_conflict_count',
        value: 0,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_demand_gap_count',
        value: 0,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
    ],
    warnings: [],
    sourceFreshness: [],
    resourceCount: 3,
    linkedUserCount: 3,
    capacity: {
      totalHours: 480,
      allocatedHours: 300,
      remainingHours: 180,
      averageUtilizationPercent: 62.5,
    },
    loadDistribution: { idle: 0, normal: 3, high: 0, overloaded: 0, unavailable: 0 },
    skillCoverage: [],
    demandGapCount: 0,
    conflictCount: 0,
  }
}

function makeCapacity(): OrganizationResourcePoolCapacityMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-02',
    rows: [
      {
        resourceId: 1,
        resourceName: '张三',
        role: '前端开发',
        loadStatus: 'normal',
        totalCapacityHours: 40,
        totalAllocatedHours: 25,
        totalRemainingHours: 15,
        utilizationPercent: 62.5,
        redacted: false,
        cells: [
          {
            date: '2026-09-01',
            capacityHours: 8,
            allocatedHours: 5,
            remainingHours: 3,
            utilizationPercent: 62.5,
            loadStatus: 'normal',
            conflictFlags: [],
          },
          {
            date: '2026-09-02',
            capacityHours: 8,
            allocatedHours: 5,
            remainingHours: 3,
            utilizationPercent: 62.5,
            loadStatus: 'normal',
            conflictFlags: [],
          },
        ],
      },
    ],
  }
}

function installDefaultBackend() {
  apiMock.summary.mockResolvedValue(makeSummary())
  apiMock.capacity.mockResolvedValue(makeCapacity())
  apiMock.resources.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
  })
  apiMock.skills.mockResolvedValue([])
  apiMock.conflicts.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
  })
  apiMock.demandGaps.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
  })
}

interface RequestRecord {
  method: string
  url: string
}
function installFetchSpy(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    records.push({ method: (init?.method ?? 'GET').toUpperCase(), url: raw })
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrganizationResourcePoolPage />
    </QueryClientProvider>,
  )
}

function resetApiMocks() {
  for (const key of Object.keys(apiMock) as Array<keyof typeof apiMock>) {
    ;(apiMock[key] as ReturnType<typeof vi.fn>).mockReset()
  }
  installDefaultBackend()
}

beforeEach(() => {
  navMock.replace.mockReset()
  navMock.push.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  setAuth(['resource:view'])
  resetApiMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('OrganizationResourcePoolPage：授权装配与面包屑回显（tasks 4.5）', () => {
  test('具备 resource:view：工作台完整装配，面包屑回显 …/resource-pool · 组织资源池', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-pool-workspace]')).not.toBeNull())
    expect(container.querySelector('[data-page-breadcrumb]')?.textContent).toBe(
      '…/resource-pool · 组织资源池',
    )
    expect(container.querySelector('[data-page-title]')?.textContent).toContain('组织资源池')
    expect(container.querySelector('[data-pool-summary]')).not.toBeNull()
  })

  test('任一集合语义：仅 org:view 亦可访问', async () => {
    setAuth(['org:view'])
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-pool-workspace]')).not.toBeNull())
    expect(container.querySelector('[data-pool-permission-fallback]')).toBeNull()
  })

  test('任一集合语义：仅 portfolio:view 亦可访问', async () => {
    setAuth(['portfolio:view'])
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-pool-workspace]')).not.toBeNull())
  })
})

describe('OrganizationResourcePoolPage：无权限受限横幅且零请求（tasks 4.5 / RL-06）', () => {
  test('无任一准入权限：渲染受限横幅，api client 零调用且全局 fetch 零记录', async () => {
    setAuth(['risk:view', 'task:view'])
    const { records } = installFetchSpy()
    const { container } = renderPage()

    expect(container.querySelector('[data-pool-permission-fallback]')).not.toBeNull()
    expect(container.textContent).toContain('无权限访问组织资源池')

    for (const key of Object.keys(apiMock) as Array<keyof typeof apiMock>) {
      expect(apiMock[key as keyof typeof apiMock]).not.toHaveBeenCalled()
    }
    expect(records.length).toBe(0)
    expect(container.querySelector('[data-pool-workspace]')).toBeNull()
  })
})

describe('OrganizationResourcePoolPage：未选择组织引导态（tasks 4.5）', () => {
  test('无有效组织上下文：渲染「请先选择组织」且零请求', async () => {
    setAuth(['resource:view'], null)
    const { records } = installFetchSpy()
    const { container } = renderPage()

    expect(container.querySelector('[data-org-guide]')).not.toBeNull()
    expect(container.textContent).toContain('请先选择组织')
    expect(container.querySelector('[data-pool-workspace]')).toBeNull()
    for (const key of Object.keys(apiMock) as Array<keyof typeof apiMock>) {
      expect(apiMock[key as keyof typeof apiMock]).not.toHaveBeenCalled()
    }
    expect(records.length).toBe(0)
  })
})
