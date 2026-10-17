/**
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.7 —— 容量环详情页面装配与 RBAC 测试
 * （页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「资源容量闭环咨询工作台（列表与详情）」+ tasks 6.7）：
 * - 具备 resource_capacity_loop:view + 合法 loopId：详情接口发起并渲染工作台；
 * - 无权限：受限横幅渲染且底层接口零请求（RL-06）；
 * - 已授权但未选择组织：引导态渲染且零查询；
 * - 非法 loopId（不可解析资源）：中性「容量环未找到」态且零网络请求（RL-05）；
 * - 后端 404（跨租户/已移除）：工作台中性未找到态、零写请求、不泄露后端 message。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ResourceCapacityLoopDetailPage from '@/app/(next)/next/organization/resource-capacity-loops/[loopId]/page'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const paramsMock = vi.hoisted(() => ({
  value: { loopId: '7' } as Record<string, string | undefined>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-capacity-loops/7',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

const API_PREFIX = 'http://localhost:3333/api/v1'
const DETAIL_PATH = '/organizations/1/resource-capacity-loops/7'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

interface RequestRecord {
  method: string
  url: string
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    records.push({ method, url: rawUrl })
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

function makeDetail() {
  return {
    loop: {
      id: 7,
      title: 'Q4 容量闭环',
      state: 'simulated',
      revision: 3,
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
    },
    baseline: { id: 77, digest: 'fnv1a:abc123', readyForSimulation: true },
    scenarios: [
      { id: 1, name: '情景一：维持现状', revision: 1, active: true },
      { id: 2, name: '情景二：前端 +20%', revision: 1, active: true },
    ],
    simulations: [{ id: 51, scenarioId: 1, digest: 'fnv1a:sim-a', staleState: 'current' }],
    currentSelection: null,
    receipts: [],
    observations: [],
    reviews: [],
    actionPosture: { writesApplied: false, confirmationRequired: true },
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ResourceCapacityLoopDetailPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navMock.push.mockReset()
  paramsMock.value = { loopId: '7' }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ResourceCapacityLoopDetailPage：详情页装配与 RBAC（tasks 6.7）', () => {
  test('具备权限 + 合法 loopId：详情接口发起并渲染工作台', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') {
        return jsonResponse(200, { data: makeDetail() })
      }
      return null
    })
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-detail-title]')?.textContent).toContain(
        'Q4 容量闭环',
      ),
    )
    expect(document.querySelector('[data-rccl-detail-state]')?.textContent).toBe('已模拟')
    expect(records.some((record) => record.url.endsWith(DETAIL_PATH))).toBe(true)
    expect(writeMethods(records)).toEqual([])
  })

  test('无 resource_capacity_loop:view：受限横幅渲染且底层接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage()

    expect(document.querySelector('[data-rccl-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看资源容量闭环的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('已授权但未选择组织：引导态渲染且零查询', async () => {
    setAuth(['resource_capacity_loop:view'], null)
    const { records } = installFetchRouter(() => null)
    renderPage()

    expect(document.querySelector('[data-rccl-org-guide]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('非法 loopId（不可解析为资源）：中性未找到态且零网络请求（RL-05）', async () => {
    setAuth(['resource_capacity_loop:view'])
    paramsMock.value = { loopId: 'not-a-number' }
    const { records } = installFetchRouter(() => null)
    renderPage()

    expect(document.querySelector('[data-rccl-loop-not-found]')).not.toBeNull()
    expect(screen.getByText('容量环未找到')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('后端 404（跨租户/已移除）：工作台中性未找到态、零写请求、不泄露后端 message', async () => {
    setAuth(['resource_capacity_loop:view'])
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') {
        return jsonResponse(404, {
          error: { code: 'RESOURCE_NOT_FOUND', message: '容量闭环不存在或无权访问' },
        })
      }
      return null
    })
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-rccl-detail-error]')).not.toBeNull())
    expect(screen.getByText('容量环未找到')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('容量闭环不存在或无权访问')
    expect(writeMethods(records)).toEqual([])
    // 返回列表动线
    expect(document.querySelector('[data-rccl-detail-back-list]')).not.toBeNull()
  })
})
