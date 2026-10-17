/**
 * v3-legacy-contract-debt-fixes W6 · tasks 6.3 —— 旧轨资源容量闭环（RCCL）列表页与详情页渲染级冒烟。
 *
 * 页面：
 * - 列表页 `app/(dashboard)/organization/resource-capacity-loops/page.tsx`（此前无专属测试）；
 * - 详情页 `…/resource-capacity-loops/[loopId]/page.tsx`（另有 `resource-capacity-loops-page.test.tsx`
 *   以 hook 桩覆盖六态，本文件补的是**真实链路**：fetch 桩 → apiFetch/apiFetchEnvelope → hook → 页面）。
 *
 * 该域是 W2（D-C）修复的直接消费方：`fetchRcclLoops` 改回 `apiFetchEnvelope`（列表信封保真）、
 * `fetchRcclLoopDetail` 解一层后即 detail 本体（页面 `!data` / `data.xxx` 才算对）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import type { RcclLoopDetail, RcclLoopListItem } from '@/lib/api/resource-capacity-loops'
import ResourceCapacityLoopsPage from '@/app/(dashboard)/organization/resource-capacity-loops/page'
import ResourceCapacityLoopDetailPage from '@/app/(dashboard)/organization/resource-capacity-loops/[loopId]/page'

// ── next/navigation / next/link 桩（详情页读 useParams.loopId） ─────────────

const navMock = vi.hoisted(() => ({
  routeParams: { loopId: '9' } as Record<string, string>,
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useParams: () => navMock.routeParams,
  useRouter: () => navMock.router,
  usePathname: () => '/organization/resource-capacity-loops',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

// ── 伪后端 ──────────────────────────────────────────────────────────────────

const ORG_ID = 1
const LOOP_ID = 9

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

function loopListItem(overrides: Partial<RcclLoopListItem> = {}): RcclLoopListItem {
  return {
    id: LOOP_ID,
    title: 'Q4 容量闭环',
    ownerUserId: 1,
    state: 'simulated',
    revision: 3,
    granularity: 'week',
    windowStart: '2026-09-01',
    windowEnd: '2026-11-30',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

function loopDetail(): RcclLoopDetail {
  return {
    loop: {
      id: LOOP_ID,
      title: 'Q4 容量闭环',
      state: 'simulated',
      revision: 3,
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
    },
    baseline: { id: 77, digest: 'fnv1a:abc123', readyForSimulation: true },
    scenarios: [{ id: 1, name: '情景一', revision: 2, active: true }],
    simulations: [{ id: 5, scenarioId: 1, digest: 'fnv1a:sim', staleState: 'current' }],
    currentSelection: null,
    receipts: [],
    observations: [],
    reviews: [],
    actionPosture: { writesApplied: false, confirmationRequired: true },
  }
}

/** 详情端点片段必须排在列表前（`…/resource-capacity-loops` 是 `…/resource-capacity-loops/9` 的前缀）。 */
function installRcclBackend(loops: RcclLoopListItem[] = [loopListItem()]) {
  return installBackend([
    [`/resource-capacity-loops/${LOOP_ID}`, () => jsonResponse(200, { data: loopDetail() })],
    [
      '/resource-capacity-loops',
      () =>
        jsonResponse(200, {
          data: loops,
          meta: {
            total: loops.length,
            page: 1,
            perPage: 20,
            totalPages: loops.length ? 1 : 0,
          },
        }),
    ],
  ])
}

// ── 会话与渲染 ──────────────────────────────────────────────────────────────

function setOrganizationContext() {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'rccl-viewer@example.com',
      fullName: '闭环观察员',
      organizations: [{ id: ORG_ID, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: accessTokenWith(['resource:view'], { organizationId: ORG_ID }),
    refreshToken: 'refresh-1',
  })
}

function renderWithQueryClient(node: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(node, { wrapper })
}

beforeEach(() => {
  navMock.routeParams = { loopId: String(LOOP_ID) }
  setOrganizationContext()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// 列表页
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨 RCCL 列表页 · 有数据', () => {
  test('闭环条目（信封端点）真实渲染：标题/状态/窗口/修订', async () => {
    const fetchMock = installRcclBackend()
    const { container } = renderWithQueryClient(<ResourceCapacityLoopsPage />)

    await waitFor(() => {
      expect(container.textContent).toContain('Q4 容量闭环')
    })

    const text = container.textContent ?? ''
    expect(text).toContain('资源容量预测闭环')
    expect(text).toContain('已模拟')
    expect(text).toContain('2026-09-01 ~ 2026-11-30')
    expect(text).toContain('修订 v3')
    expect(screen.getByLabelText('容量闭环列表')).toBeInTheDocument()
    expect(screen.queryByTestId('rccl-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rccl-empty')).not.toBeInTheDocument()

    const urls = fetchMock.mock.calls.map((call) =>
      String(call[0] instanceof URL ? call[0].href : call[0]),
    )
    expect(
      urls.some((url) => url.includes(`/organizations/${ORG_ID}/resource-capacity-loops`)),
    ).toBe(true)
  })

  test('空列表渲染空态而不是崩溃', async () => {
    installRcclBackend([])
    renderWithQueryClient(<ResourceCapacityLoopsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rccl-empty')).toBeInTheDocument()
    })
    expect(screen.getByText('尚无容量闭环计划')).toBeInTheDocument()
    expect(screen.queryByTestId('rccl-error')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 详情页
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨 RCCL 详情页 · 有数据', () => {
  test('单键端点解包后的 detail 本体直接渲染（修复前 data.data 恒 undefined → 恒错误态）', async () => {
    const fetchMock = installRcclBackend()
    renderWithQueryClient(<ResourceCapacityLoopDetailPage />)

    expect(await screen.findByText('Q4 容量闭环')).toBeInTheDocument()
    expect(screen.queryByTestId('rccl-detail-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('rccl-state').textContent).toBe('已模拟')
    // 事实/假设双重区分的基线区与情景区
    expect(screen.getByText('事实数据')).toBeInTheDocument()
    expect(screen.getByTestId('rccl-fact-table')).toBeInTheDocument()
    expect(screen.getByText('假设')).toBeInTheDocument()
    expect(screen.getByTestId('rccl-scenario-list').textContent).toContain('情景一')
    expect(screen.getByTestId('rccl-posture-note').textContent).toContain('咨询性质')

    const urls = fetchMock.mock.calls.map((call) =>
      String(call[0] instanceof URL ? call[0].href : call[0]),
    )
    expect(
      urls.some((url) =>
        url.includes(`/organizations/${ORG_ID}/resource-capacity-loops/${LOOP_ID}`),
      ),
    ).toBe(true)
  })
})
