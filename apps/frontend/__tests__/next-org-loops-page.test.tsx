/**
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.7 —— 容量环列表页面装配与 RBAC 测试
 * （页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「资源容量闭环咨询工作台（列表与详情）」RBAC 场景 + tasks 6.7）：
 * - 具备 resource_capacity_loop:view：渲染列表行（底层列表接口真实发起）；
 * - 无权限：受限横幅渲染且底层接口零请求（RL-06）；
 * - 已授权但未选择组织：渲染「请先选择组织」引导态且零查询。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ResourceCapacityLoopsPage from '@/app/(next)/next/organization/resource-capacity-loops/page'
import type { RcclLoopListItem } from '@/lib/api/resource-capacity-loops'

// ---------------------------------------------------------------------------
// next/navigation + next/link mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-capacity-loops',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

function makeLoop(): RcclLoopListItem {
  return {
    id: 1,
    title: 'Q4 容量闭环',
    ownerUserId: 1,
    state: 'draft',
    revision: 1,
    granularity: 'week',
    windowStart: '2026-09-01',
    windowEnd: '2026-11-30',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ResourceCapacityLoopsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navMock.push.mockReset()
  searchParamsMock.value = new URLSearchParams()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ResourceCapacityLoopsPage：列表页装配与 RBAC（tasks 6.7）', () => {
  test('具备 resource_capacity_loop:view：列表接口发起并渲染行', async () => {
    setAuth(['resource_capacity_loop:view'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1/resource-capacity-loops' && method === 'GET') {
        return jsonResponse(200, {
          data: [makeLoop()],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1))
    expect(screen.getByText('Q4 容量闭环')).toBeInTheDocument()
    expect(
      records.some((record) => record.url.endsWith('/organizations/1/resource-capacity-loops')),
    ).toBe(true)
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
})
