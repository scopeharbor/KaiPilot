/**
 * v3-legacy-contract-debt-fixes W6 · tasks 6.3 —— 旧轨跨项目资源调配页渲染级冒烟（M9／R1 承接）。
 *
 * 页面：`app/(dashboard)/organization/cross-project-resource-allocation/page.tsx`
 *（此前无 page 级渲染测试）。该页是 W1 双向错配修复的直接消费方：
 * - `listDrafts` 改回 `apiFetchEnvelope` 后 `data?.data` / `meta` 才正确（修复前列表恒空）；
 * - `getDraft` 改为单键 `apiFetch<T>` 后 `draftQuery.data` 才是草案本体（修复前恒 undefined）。
 * 本文件用 `global.fetch` 伪后端（后端真实形状）走完整链路，断言列表与详情面板真实渲染。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import type {
  CrossProjectAllocationConfirmation,
  CrossProjectAllocationDraft,
  CrossProjectAllocationDraftDetail,
  CrossProjectAllocationDraftItem,
  CrossProjectAllocationQueryShape,
} from '@aiproj/types'
import CrossProjectResourceAllocationPage from '@/app/(dashboard)/organization/cross-project-resource-allocation/page'

// ── next/navigation / next/link 桩 ─────────────────────────────────────────

const navMock = vi.hoisted(() => ({ search: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => navMock.search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/organization/cross-project-resource-allocation',
  useParams: () => ({}),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

// ── 伪后端 ──────────────────────────────────────────────────────────────────

const ORG_ID = 1
const DRAFT_ID = '2'

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

function queryShape(): CrossProjectAllocationQueryShape {
  return {
    organizationId: ORG_ID,
    projectIds: [9],
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
  }
}

function makeDraft(): CrossProjectAllocationDraft {
  return {
    id: DRAFT_ID,
    organizationId: ORG_ID,
    status: 'draft',
    name: 'Q3 前端人力调配',
    queryShape: queryShape(),
    itemCount: 1,
    evidence: null,
    previewHash: null,
    previewExpiresAt: null,
    warnings: [],
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01T02:00:00.000Z',
  }
}

function makeDraftItem(): CrossProjectAllocationDraftItem {
  return {
    id: 'ITEM-1',
    itemType: 'allocate',
    status: 'ready',
    demand: {
      id: 'DEM-1',
      targetProjectId: 9,
      targetProjectName: '项目甲',
      targetTaskId: 99,
      targetTaskName: '前端看板改造',
      requiredSkillTags: ['typescript'],
      requiredHours: 120,
      requiredRole: 'frontend',
      startDate: '2026-09-15',
      endDate: '2026-10-15',
      priority: 1,
      currentAllocationPercent: 0,
    },
    candidate: null,
    allocationPercent: 60,
    startDate: '2026-09-15',
    endDate: '2026-10-15',
    conflicts: [],
    source: 'rule',
    advisoryOnly: true,
    confirmationRequired: true,
    applied: false,
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01T02:00:00.000Z',
  }
}

function makeConfirmation(): CrossProjectAllocationConfirmation {
  return {
    id: 'CONF-1',
    draftId: DRAFT_ID,
    actorId: 1,
    organizationId: ORG_ID,
    visibleTargetProjectIds: [9],
    itemIds: ['ITEM-1'],
    previewHash: 'hash-abc123',
    queryShape: queryShape(),
    warnings: [],
    idempotencyKeyHash: 'idem-hash',
    confirmedAt: '2026-09-02T02:00:00.000Z',
  }
}

function makeDraftDetail(): CrossProjectAllocationDraftDetail {
  return {
    ...makeDraft(),
    items: [makeDraftItem()],
    confirmation: makeConfirmation(),
    applyResult: null,
  }
}

function installDraftsBackend(drafts: CrossProjectAllocationDraft[] = [makeDraft()]) {
  return installBackend([
    // 详情端点必须排在列表前面：`/drafts` 是 `/drafts/2` 的前缀。
    [
      `/cross-project-resource-allocations/drafts/${DRAFT_ID}`,
      () => jsonResponse(200, { data: makeDraftDetail() }),
    ],
    [
      '/cross-project-resource-allocations/drafts',
      () =>
        jsonResponse(200, {
          data: drafts,
          meta: {
            total: drafts.length,
            page: 1,
            perPage: 20,
            totalPages: drafts.length ? 1 : 0,
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
      email: 'allocator@example.com',
      fullName: '调配管理员',
      organizations: [{ id: ORG_ID, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: accessTokenWith(['resource:view', 'resource:manage'], { organizationId: ORG_ID }),
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
  return render(<CrossProjectResourceAllocationPage />, { wrapper })
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
// 有数据：草案列表
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨跨项目调配页 · 草案列表', () => {
  test('信封式草案列表真实落地（修复前 data?.data 恒为空 → 恒空态）', async () => {
    const fetchMock = installDraftsBackend()
    renderPage()

    expect(await screen.findByText('跨项目资源调配')).toBeInTheDocument()
    expect(await screen.findByText('Q3 前端人力调配')).toBeInTheDocument()
    expect(screen.getByText('草案')).toBeInTheDocument()
    expect(screen.getByText('项目数: 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建调配草案/ })).toBeInTheDocument()

    const urls = fetchMock.mock.calls.map((call) =>
      String(call[0] instanceof URL ? call[0].href : call[0]),
    )
    expect(
      urls.some((url) =>
        url.includes(`/organizations/${ORG_ID}/cross-project-resource-allocations/drafts`),
      ),
    ).toBe(true)

    expect(screen.queryByText('暂无调配草案')).not.toBeInTheDocument()
    expect(screen.queryByText('无权查看跨项目资源调配')).not.toBeInTheDocument()
  })

  test('空列表渲染空态而不是崩溃', async () => {
    installDraftsBackend([])
    renderPage()

    expect(await screen.findByText('暂无调配草案')).toBeInTheDocument()
    expect(screen.queryByText('无权查看跨项目资源调配')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 有数据：草案详情面板（单键端点解包后的草案本体）
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨跨项目调配页 · 草案详情面板', () => {
  test('?draft=2 时详情面板渲染调配项与确认信息（修复前恒 undefined）', async () => {
    navMock.search = new URLSearchParams(`draft=${DRAFT_ID}`)
    installDraftsBackend()
    renderPage()

    // 列表卡标题与详情面板标题各一处
    await waitFor(() => {
      expect(screen.getAllByText('Q3 前端人力调配').length).toBeGreaterThan(1)
    })
    expect(screen.getByText('分配')).toBeInTheDocument()
    expect(screen.getByText('目标项目 #9')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('预览哈希: hash-abc123')).toBeInTheDocument()
    expect(screen.queryByText('暂无调配项')).not.toBeInTheDocument()
  })
})
