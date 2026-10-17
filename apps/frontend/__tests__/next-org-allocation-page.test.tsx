/**
 * v3-ui-next-org-portfolio-domains W7 · tasks 7.5 —— 跨项目调配页面装配与 RBAC 测试
 * （真实页面路由 + 全局伪后端）。
 *
 * 覆盖（spec「跨项目资源调配草案工作台」/ design Decision 6）：
 * - 无 `resource:view` 且无 `portfolio:view`：受限横幅物理阻断且底层草案/候选接口
 *   零请求（RL-06 防探测）；
 * - 未选择组织（currentOrganizationId=null）：「请先选择组织」引导态且零请求；
 * - 授权用户完整装配：工作台渲染、草案列表加载、标题回显；
 * - 写按钮可见性镜像后端不对称口径（design Decision 6 核对点）：
 *   portfolio:view 单持可见写入口；仅 resource:view 不可见。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import CrossProjectResourceAllocationPage from '@/app/(next)/next/organization/cross-project-resource-allocation/page'
import type { CrossProjectAllocationDraft } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const spMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/cross-project-resource-allocation',
  useParams: () => ({}),
  useSearchParams: () => spMock.value,
}))

// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(records: RequestRecord[]): void {
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    records.push({ method, url: rawUrl.replace(API_PREFIX, '') })
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } })
  }
  vi.stubGlobal('fetch', fetchMock)
}

function installHappyBackend(
  records: RequestRecord[],
  drafts: CrossProjectAllocationDraft[],
): void {
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const base = '/organizations/1/cross-project-resource-allocations'
    // 响应形态贴近真实后端单层包裹（apiFetch 解包后运行时为数组/裸载荷）
    if (
      (method === 'GET' && path === `${base}/drafts`) ||
      (method === 'GET' && path.startsWith(`${base}/drafts?`))
    ) {
      return jsonResponse(200, {
        data: drafts,
        meta: { total: drafts.length, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    const detailMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)$/.exec(path)
    if (method === 'GET' && detailMatch) {
      return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '草案不存在' } })
    }
    if (method === 'GET' && path.startsWith(`${base}/candidates`)) {
      return jsonResponse(200, { data: [], meta: { total: 0, topN: 20, hasMore: false } })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } })
  }
  vi.stubGlobal('fetch', fetchMock)
}

function resetFetch() {
  vi.unstubAllGlobals()
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
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

function makeDraft(id: string): CrossProjectAllocationDraft {
  return {
    id,
    organizationId: 1,
    status: 'draft',
    name: `草案 ${id}`,
    queryShape: {
      organizationId: 1,
      projectIds: [],
      dateWindow: { from: '2026-09-01', to: '2026-11-30' },
      resourceTypes: [],
      roles: [],
      skillTags: [],
      departments: [],
      loadStatuses: [],
      conflictSeverities: [],
      draftStatuses: [],
      search: null,
      sort: 'created_at',
      sortDir: 'desc',
      page: 1,
      perPage: 20,
      topN: 10,
      freshnessThresholdMinutes: 60,
    },
    itemCount: 0,
    evidence: null,
    previewHash: null,
    previewExpiresAt: null,
    warnings: [],
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01T02:00:00.000Z',
  }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

beforeEach(() => {
  spMock.value = new URLSearchParams()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

afterEach(() => {
  resetFetch()
})

describe('页面准入门禁（RL-06 防探测）', () => {
  test('无 resource:view / portfolio:view：受限横幅渲染且底层接口零请求', async () => {
    setAuth(['org:view'])
    const records: RequestRecord[] = []
    installFetchRouter(records)
    renderWithClient(<CrossProjectResourceAllocationPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.body.textContent).toContain('你没有查看跨项目资源调配的权限')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(records).toHaveLength(0)
  })

  test('未选择组织（currentOrganizationId=null）：引导态且零请求', async () => {
    setAuth(['resource:view', 'portfolio:view'], null)
    const records: RequestRecord[] = []
    installFetchRouter(records)
    renderWithClient(<CrossProjectResourceAllocationPage />)

    expect(document.querySelector('[data-allocation-org-guide]')).not.toBeNull()
    expect(document.body.textContent).toContain('请先选择组织')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(records).toHaveLength(0)
  })
})

describe('授权装配与写按钮口径镜像（design Decision 6）', () => {
  test('resource:view + resource:manage：工作台装配、草案列表加载、标题回显', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const records: RequestRecord[] = []
    installHappyBackend(records, [makeDraft('2'), makeDraft('3')])
    renderWithClient(<CrossProjectResourceAllocationPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-workspace]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-draft-row]')).toHaveLength(2),
    )
    expect(document.querySelector('h1')?.textContent).toContain('跨项目资源调配')
    expect(document.querySelector('[data-allocation-create]')).not.toBeNull()
    expect(writeMethods(records)).toEqual([])
  })

  test('仅 portfolio:view（无 resource:manage）：写入口仍可见——与后端 CrossProjectAllocationPolicy 口径一致', async () => {
    setAuth(['portfolio:view'])
    const records: RequestRecord[] = []
    installHappyBackend(records, [makeDraft('2')])
    renderWithClient(<CrossProjectResourceAllocationPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-workspace]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-draft-row]')).toHaveLength(1),
    )
    expect(document.querySelector('[data-allocation-create]')).not.toBeNull()
    expect(document.querySelector('[data-allocation-write-scope]')).not.toBeNull()
    expect(writeMethods(records)).toEqual([])
  })

  test('仅 resource:view（无写权）：工作台只读装配、新建入口物理隐藏、零写请求', async () => {
    setAuth(['resource:view'])
    const records: RequestRecord[] = []
    installHappyBackend(records, [makeDraft('2')])
    renderWithClient(<CrossProjectResourceAllocationPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-workspace]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-draft-row]')).toHaveLength(1),
    )
    expect(document.querySelector('[data-allocation-create]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeMethods(records)).toEqual([])
  })
})
