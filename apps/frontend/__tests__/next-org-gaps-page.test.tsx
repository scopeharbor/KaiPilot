/**
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.9 —— 资源缺口分析页面装配与 RBAC 测试。
 *
 * 覆盖（spec「组织资源池与资源缺口分析」+ RBAC 矩阵）：
 * - 授权（任一 org:view/portfolio:view/resource:view）：工作台装配 + 面包屑回显
 *   （…/resource-gaps · 资源缺口分析）；
 * - 无任一准入权限：受限横幅（data-gaps-permission-fallback）且业务请求零发出
 *   （RL-06：summary api 零调用、维度 hooks 零调用、全局 fetch 零记录）；
 * - 未选择组织：引导态（data-org-guide）且零请求；
 * - portfolio:view 单独权限语义（PM 角色兜底通道）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrganizationResourceGapsPage from '@/app/(next)/next/organization/resource-gaps/page'
import type { ResourceGapSummary } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-gaps',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

// ---------------------------------------------------------------------------
// 数据层 mock（装配验证：授权态数据路径 / 受限态零调用）
// ---------------------------------------------------------------------------
const gapApiMock = vi.hoisted(() => ({ summary: vi.fn() }))
vi.mock('@/lib/api/resource-gap-analysis', () => ({
  resourceGapApi: gapApiMock,
  resourceGapKeys: {
    all: (organizationId: number) => ['resource-gaps', organizationId] as const,
    summary: (organizationId: number, query?: unknown) =>
      ['resource-gaps', organizationId, 'summary', query] as const,
  },
}))

const hooksMock = vi.hoisted(() => ({
  byRole: vi.fn(),
  bySkill: vi.fn(),
  byTimebucket: vi.fn(),
  byProject: vi.fn(),
  byPortfolio: vi.fn(),
}))
vi.mock('@/hooks/use-resource-gap-analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-resource-gap-analysis')>()
  return {
    ...actual,
    useResourceGapByRole: hooksMock.byRole,
    useResourceGapBySkill: hooksMock.bySkill,
    useResourceGapByTimebucket: hooksMock.byTimebucket,
    useResourceGapByProject: hooksMock.byProject,
    useResourceGapByPortfolio: hooksMock.byPortfolio,
  }
})

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

function makeSummary(totalGaps: number): ResourceGapSummary {
  return {
    meta: {
      organizationId: 1,
      actorId: 1,
      metricVersion: 'resource-gap-analysis@1',
      calculatedAt: '2026-09-01T08:00:00.000Z',
      querySignatureHash: 'abc',
      visibleProjectCount: 2,
      visibleResourceCount: 12,
      dateWindow: { from: '2026-06-01', to: '2026-08-31' },
      upstreamAvailability: {
        demandForecasting: true,
        contentionDetection: true,
        skillMatrix: true,
        resourcePool: true,
      },
      sourceFreshness: {},
    },
    totalGaps,
    severityDistribution: { critical: totalGaps > 0 ? 1 : 0, high: 0, medium: 0, low: 0, none: 0 },
    metricDistribution: {
      allocated_vs_demand: 0,
      available_vs_demand: 0,
      skill_shortfall: 0,
      forecast_gap: 0,
    },
    dimensionDistribution: {
      role: 0,
      skill: 1,
      timeBucket: 0,
      project: 0,
      portfolio: 0,
      organization: 0,
    },
    totalDemandHours: 200,
    totalSupplyHours: 120,
    totalGapHours: 80,
    averageGapRatio: 0.4,
    topGaps: [],
    warnings: [],
  }
}

function installDefaultBackend() {
  gapApiMock.summary.mockResolvedValue(makeSummary(1))
  const idle = {
    data: { data: [] as never[], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(() => Promise.resolve()),
  }
  hooksMock.byRole.mockReturnValue(idle)
  hooksMock.bySkill.mockReturnValue(idle)
  hooksMock.byTimebucket.mockReturnValue(idle)
  hooksMock.byProject.mockReturnValue(idle)
  hooksMock.byPortfolio.mockReturnValue(idle)
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
      <OrganizationResourceGapsPage />
    </QueryClientProvider>,
  )
}

function resetAllMocks() {
  gapApiMock.summary.mockReset()
  for (const key of Object.keys(hooksMock) as Array<keyof typeof hooksMock>) {
    hooksMock[key].mockReset()
  }
  installDefaultBackend()
}

beforeEach(() => {
  navMock.replace.mockReset()
  navMock.push.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  setAuth(['resource:view'])
  resetAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('OrganizationResourceGapsPage：授权装配与面包屑回显（tasks 4.9）', () => {
  test('具备 resource:view：工作台完整装配，面包屑 …/resource-gaps · 资源缺口分析', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    expect(container.querySelector('[data-page-breadcrumb]')?.textContent).toBe(
      '…/resource-gaps · 资源缺口分析',
    )
    expect(container.querySelector('[data-page-title]')?.textContent).toContain('资源缺口分析')
    expect(container.querySelector('[data-gap-stats]')).not.toBeNull()
  })

  test('任一集合语义：仅 org:view 亦可访问', async () => {
    setAuth(['org:view'])
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    expect(container.querySelector('[data-gaps-permission-fallback]')).toBeNull()
  })

  test('任一集合语义：仅 portfolio:view（PM 角色兜底通道）亦可访问', async () => {
    setAuth(['portfolio:view'])
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
  })
})

describe('OrganizationResourceGapsPage：无权限受限横幅且零请求（tasks 4.9 / RL-06）', () => {
  test('无任一准入权限：受限横幅，summary api/维度 hooks 零调用且 fetch 零记录', async () => {
    setAuth(['task:view'])
    const { records } = installFetchSpy()
    const { container } = renderPage()

    expect(container.querySelector('[data-gaps-permission-fallback]')).not.toBeNull()
    expect(container.textContent).toContain('无权限访问资源缺口分析')
    expect(container.querySelector('[data-gap-workspace]')).toBeNull()

    expect(gapApiMock.summary).not.toHaveBeenCalled()
    for (const key of Object.keys(hooksMock) as Array<keyof typeof hooksMock>) {
      expect(hooksMock[key]).not.toHaveBeenCalled()
    }
    expect(records.length).toBe(0)
  })
})

describe('OrganizationResourceGapsPage：未选择组织引导态（tasks 4.9）', () => {
  test('无有效组织上下文：「请先选择组织」且零请求', async () => {
    setAuth(['resource:view'], null)
    const { records } = installFetchSpy()
    const { container } = renderPage()

    expect(container.querySelector('[data-org-guide]')).not.toBeNull()
    expect(container.textContent).toContain('请先选择组织')
    expect(container.querySelector('[data-gap-workspace]')).toBeNull()
    expect(gapApiMock.summary).not.toHaveBeenCalled()
    expect(records.length).toBe(0)
  })
})
