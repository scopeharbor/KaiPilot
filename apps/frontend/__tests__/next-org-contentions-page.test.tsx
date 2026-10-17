/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.5 —— 争用页面入口装配与 RBAC 测试。
 *
 * - 权限守卫口径：`org:view`/`portfolio:view`/`resource:view` 任一即可
 *   （与后端 ResourceContentionDetectionPolicy 视图并集一致）；无权限渲染受限横幅
 *   且底层争用接口零请求（RL-06）；
 * - 组织上下文：未选择组织 → 「请先选择组织」引导态且零请求（RL-05，组织 ID 取自
 *   auth store 有效租户上下文，绝不出现在 URL）；
 * - 授权用户完整装配：工作台渲染并发出数据请求；面包屑坐标由顶栏静态坐标回显
 *   （resolveSpaceBreadcrumb 派生自坐标白名单，接线 W10 落地后回显
 *   `/next/organization/resource-contentions · <坐标标题>`，此处不重复断言接线产物）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrganizationResourceContentionsPage from '@/app/(next)/next/organization/resource-contentions/page'
import type { ResourceContentionSummary } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-contentions',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      // 有效组织上下文语义：orgId 为 null 时视为无任何组织成员关系（selectEffectiveOrganizationId 无法解析）
      organizations:
        organizationId === null
          ? []
          : [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function makeSummary(): ResourceContentionSummary {
  return {
    meta: {
      calculatedAt: '2026-09-02T00:00:00.000Z',
      metricVersion: 'resource-contention-detection.v1',
      organizationId: 1,
      actorId: 1,
      visibleProjectCount: 1,
      visibleResourceCount: 1,
      querySignatureHash: 'sig',
      sourceSignatureHash: 'sig2',
    },
    severityCounts: { critical: 0, high: 1, warning: 0, info: 0 },
    reasonCounts: {
      'cross-project-overload': 1,
      'unavailable-allocation': 0,
      'critical-skill-contention': 0,
      'duplicate-reservation': 0,
      'demand-window-contention': 0,
      'draft-allocation-contention': 0,
    },
    affectedProjectCount: 1,
    affectedResourceCount: 1,
    totalContentions: 1,
    sourceFreshness: [],
    warnings: [],
    evidenceHashes: [],
  }
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: Array<{ method: string; url: string }>
} {
  const records: Array<{ method: string; url: string }> = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function backendRoute(path: string, method: string): Response | null {
  if (method !== 'GET') return null
  if (path.startsWith('/organizations/1/resource-contentions/summary')) {
    return jsonResponse(200, { data: makeSummary() })
  }
  if (path.startsWith('/organizations/1/resource-contentions/items')) {
    return jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 1 } })
  }
  if (path.startsWith('/organizations/1/resource-contentions/matrix')) {
    return jsonResponse(200, { data: { from: '2026-09-01', to: '2026-09-02', rows: [] } })
  }
  return null
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OrganizationResourceContentionsPage />
    </QueryClientProvider>,
  )
}

const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE']

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  window.history.replaceState({}, '', '/next/organization/resource-contentions')
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('资源争用页面入口：权限矩阵与零请求（tasks 5.5）', () => {
  test('具备 org:view：完整装配并发出争用数据请求', async () => {
    setAuth(['org:view', 'resource:view'])
    const { records } = installFetchRouter(backendRoute)
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-contention-workspace]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelector('[data-contention-summary]')).not.toBeNull())
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-no-organization-guide]')).toBeNull()
    // 标题回显
    expect(document.querySelector('[data-contention-title]')?.textContent).toBe('资源争用检测')
    expect(records.some((r) => r.url.includes('/resource-contentions/summary'))).toBe(true)
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('任一权限即可准入：仅 portfolio:view（PM 无 org:view）亦可加载数据', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter(backendRoute)
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-contention-workspace]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelector('[data-contention-summary]')).not.toBeNull())
    expect(records.some((r) => r.url.includes('/resource-contentions/summary'))).toBe(true)
  })

  test('仅 resource:view（无组合视野）亦可准入', async () => {
    setAuth(['resource:view'])
    const { records } = installFetchRouter(backendRoute)
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-contention-workspace]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelector('[data-contention-summary]')).not.toBeNull())
    expect(records.some((r) => r.url.includes('/resource-contentions/summary'))).toBe(true)
  })

  test('无 org:view/portfolio:view/resource:view：受限横幅渲染且底层接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-contention-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('未选择组织：引导态「请先选择组织」且零请求（RL-05）', async () => {
    setAuth(['org:view', 'portfolio:view', 'resource:view'], null)
    const { records } = installFetchRouter(() => null)
    renderPage()
    expect(document.querySelector('[data-no-organization-guide]')).not.toBeNull()
    expect(document.querySelector('[data-contention-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})
