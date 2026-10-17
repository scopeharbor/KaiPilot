/**
 * v3-legacy-contract-debt-fixes W6 · tasks 6.3 —— 旧轨组织资源池页渲染级冒烟（M9／R1 承接）。
 *
 * 页面：`app/(dashboard)/organization/resource-pool/page.tsx`。
 * 既有 `organization-resource-pool-page.test.tsx` 以 `vi.mock('@/hooks/use-organization-resource-pool')`
 * 覆盖页面装配（拿不到被修的 api/hook 解包层）；本文件补的是**真实链路**：
 * `global.fetch` 伪后端（后端真实形状）→ `apiFetch` / `apiFetchEnvelope` → hook → 页面，
 * 证明 W1 修复后首屏真正拿到数据、无 `undefined` 穿透。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import {
  normalOrganizationResourcePool,
  type OrganizationResourcePoolCapacityMatrix,
  type OrganizationResourcePoolResourceRow,
  type OrganizationResourcePoolSkillItem,
  type OrganizationResourcePoolSummary,
} from '@aiproj/types'
import OrganizationResourcePoolPage from '@/app/(dashboard)/organization/resource-pool/page'

// ── next/navigation / next/link 桩 ─────────────────────────────────────────

const navMock = vi.hoisted(() => ({ search: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => navMock.search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/organization/resource-pool',
  useParams: () => ({}),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

// ── 伪后端 ──────────────────────────────────────────────────────────────────

const ORG_ID = 1

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installBackend(
  routes: Array<[needle: string, respond: () => Response]>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const matched = routes.find(([needle]) => url.includes(needle))
    if (!matched) {
      return Promise.resolve(
        jsonResponse(500, { error: { code: 'UNMATCHED_TEST_ROUTE', message: url } }),
      )
    }
    return Promise.resolve(matched[1]())
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// ── 后端真实载荷 ────────────────────────────────────────────────────────────

function capacityMatrix(): OrganizationResourcePoolCapacityMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    rows: [
      {
        resourceId: 1,
        resourceName: '张三',
        role: 'developer',
        loadStatus: 'high',
        totalCapacityHours: 160,
        totalAllocatedHours: 144,
        totalRemainingHours: 16,
        utilizationPercent: 90,
        redacted: false,
        cells: [
          {
            date: '2026-09-01',
            capacityHours: 8,
            allocatedHours: 8,
            remainingHours: 0,
            utilizationPercent: 100,
            loadStatus: 'overloaded',
            conflictFlags: [],
          },
        ],
      },
    ],
  }
}

function resourceRows(): OrganizationResourcePoolResourceRow[] {
  return [
    {
      resourceId: 1,
      resourceName: '张三',
      resourceType: 'human',
      role: 'developer',
      status: 'active',
      skillTags: ['typescript', 'react'],
      department: null,
      linkedUserId: null,
      projectCount: 2,
      totalCapacityHours: 160,
      totalAllocatedHours: 144,
      totalRemainingHours: 16,
      utilizationPercent: 90,
      loadStatus: 'high',
      conflictFlags: [],
      freshness: null,
      target: null,
      redacted: false,
    },
  ]
}

function skillItems(): OrganizationResourcePoolSkillItem[] {
  return [
    {
      skill: 'typescript',
      resourceCount: 5,
      capacityHours: 1200,
      allocatedHours: 600,
      remainingHours: 600,
      demandCount: 2,
      gap: false,
      redacted: false,
    },
  ]
}

function emptyPoolSummary(): OrganizationResourcePoolSummary {
  return {
    ...normalOrganizationResourcePool,
    metrics: normalOrganizationResourcePool.metrics.map((metric) => ({ ...metric, value: 0 })),
    resourceCount: 0,
    linkedUserCount: 0,
    capacity: {
      totalHours: 0,
      allocatedHours: 0,
      remainingHours: 0,
      averageUtilizationPercent: 0,
    },
    loadDistribution: { idle: 0, normal: 0, high: 0, overloaded: 0, unavailable: 0 },
    skillCoverage: [],
    demandGapCount: 0,
    conflictCount: 0,
  }
}

function installHappyBackend(
  summary: OrganizationResourcePoolSummary = normalOrganizationResourcePool,
) {
  const emptyMeta = { total: 0, page: 1, perPage: 20, totalPages: 0 }
  return installBackend([
    ['/resource-pool/summary', () => jsonResponse(200, { data: summary })],
    [
      '/resource-pool/resources',
      () =>
        jsonResponse(200, {
          data: resourceRows(),
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
    ],
    ['/resource-pool/skills', () => jsonResponse(200, { data: skillItems() })],
    ['/resource-pool/capacity', () => jsonResponse(200, { data: capacityMatrix() })],
    ['/resource-pool/conflicts', () => jsonResponse(200, { data: [], meta: emptyMeta })],
    ['/resource-pool/demand-gaps', () => jsonResponse(200, { data: [], meta: emptyMeta })],
  ])
}

// ── 会话与渲染 ──────────────────────────────────────────────────────────────

function setOrganizationContext(permissions: string[] = ['org:view', 'resource:view']) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'pool-viewer@example.com',
      fullName: '资源池观察员',
      organizations: [{ id: ORG_ID, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: ORG_ID }),
    refreshToken: 'refresh-1',
  })
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<OrganizationResourcePoolPage />, { wrapper })
}

beforeEach(() => {
  navMock.search = new URLSearchParams()
  setOrganizationContext()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// 有数据：KPI 条 + 默认容量矩阵视图
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨组织资源池页 · 有数据', () => {
  test('KPI 条与容量矩阵真实渲染（修复前 summary 恒 undefined → 恒骨架屏）', async () => {
    const fetchMock = installHappyBackend()
    renderPage()

    expect(await screen.findByText('组织资源池')).toBeInTheDocument()
    expect(await screen.findByText('资源总数')).toBeInTheDocument()
    // 「总容量」「利用率」同时是 KPI 标签与容量矩阵列头，故用 getAllByText
    expect(screen.getAllByText('总容量').length).toBeGreaterThan(0)
    expect(screen.getAllByText('利用率').length).toBeGreaterThan(0)

    // 默认视图 = 容量矩阵，行数据来自单键端点解包后的载荷本体
    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: /容量矩阵/ })).toHaveAttribute('aria-selected', 'true')

    const urls = fetchMock.mock.calls.map((call) =>
      String(call[0] instanceof URL ? call[0].href : call[0]),
    )
    expect(urls.some((url) => url.includes(`/organizations/${ORG_ID}/resource-pool/summary`))).toBe(
      true,
    )
    expect(urls.some((url) => url.includes('/resource-pool/capacity'))).toBe(true)

    expect(screen.queryByText('加载组织资源池失败，请稍后重试。')).not.toBeInTheDocument()
    expect(screen.queryByText('当前组织没有可见项目或资源')).not.toBeInTheDocument()
  })

  test('切换到资源列表视图不崩溃：信封端点 data/meta 被正确读取', async () => {
    installHappyBackend()
    renderPage()

    await screen.findByText('资源总数')
    await act(async () => {
      screen.getByRole('tab', { name: /资源列表/ }).click()
    })

    await waitFor(() => {
      expect(screen.getByText('typescript')).toBeInTheDocument()
    })
    expect(screen.queryByText('无资源数据')).not.toBeInTheDocument()
    expect(screen.queryByText('加载组织资源池失败，请稍后重试。')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 空组织：空态而不是崩溃
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨组织资源池页 · 空组织', () => {
  test('resourceCount 与总容量均为 0 时渲染空态引导', async () => {
    installHappyBackend(emptyPoolSummary())
    renderPage()

    expect(await screen.findByText('当前组织没有可见项目或资源')).toBeInTheDocument()
    expect(screen.queryByText('加载组织资源池失败，请稍后重试。')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 无权限：受限横幅
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨组织资源池页 · 无权限', () => {
  test('缺少 org:view / portfolio:view / resource:view 时渲染受限提示', async () => {
    setOrganizationContext([])
    installHappyBackend()
    renderPage()

    expect(await screen.findByText('您没有组织资源池访问权限。')).toBeInTheDocument()
  })
})
