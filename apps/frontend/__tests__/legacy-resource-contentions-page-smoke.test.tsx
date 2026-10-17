/**
 * v3-legacy-contract-debt-fixes W6 · tasks 6.3 —— 旧轨资源争用页渲染级冒烟（M9／R1 承接）。
 *
 * 页面：`app/(dashboard)/organization/resource-contentions/page.tsx`（此前无 page 级渲染测试）。
 * 重点：**suggestions 区是 W1 修复后首次能真正拿到数据**——修复前 hook 二次解包把
 * `{data: [...]}` 解成 `undefined`，建议动作区块永远不渲染。本文件用 `global.fetch`
 * 伪后端（后端真实形状）走完整链路，断言该区块在真实数据下出现。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import {
  RESOURCE_CONTENTION_REASON_CODES,
  RESOURCE_CONTENTION_SEVERITIES,
  type ResourceContentionItem,
  type ResourceContentionMatrix,
  type ResourceContentionSuggestionPreview,
  type ResourceContentionSummary,
} from '@aiproj/types'
import ResourceContentionDetectionPage from '@/app/(dashboard)/organization/resource-contentions/page'

// ── next/navigation / next/link 桩 ─────────────────────────────────────────

const navMock = vi.hoisted(() => ({ search: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => navMock.search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/organization/resource-contentions',
  useParams: () => ({}),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

// ── 伪后端 ──────────────────────────────────────────────────────────────────

const ORG_ID = 1
const CONTENTION_ID = 'CON-1'

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

function contentionSummary(totalContentions: number): ResourceContentionSummary {
  return {
    meta: {
      calculatedAt: '2026-09-10T00:00:00.000Z',
      metricVersion: 'v1',
      organizationId: ORG_ID,
      actorId: 1,
      visibleProjectCount: 2,
      visibleResourceCount: 3,
      querySignatureHash: 'qsig',
      sourceSignatureHash: 'ssig',
    },
    severityCounts: {
      [RESOURCE_CONTENTION_SEVERITIES.INFO]: 0,
      [RESOURCE_CONTENTION_SEVERITIES.WARNING]: 1,
      [RESOURCE_CONTENTION_SEVERITIES.HIGH]: 1,
      [RESOURCE_CONTENTION_SEVERITIES.CRITICAL]: totalContentions > 0 ? 1 : 0,
    },
    reasonCounts: {
      [RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD]: 1,
      [RESOURCE_CONTENTION_REASON_CODES.UNAVAILABLE_ALLOCATION]: 1,
      [RESOURCE_CONTENTION_REASON_CODES.CRITICAL_SKILL_CONTENTION]: 1,
      [RESOURCE_CONTENTION_REASON_CODES.DUPLICATE_RESERVATION]: 0,
      [RESOURCE_CONTENTION_REASON_CODES.DEMAND_WINDOW_CONTENTION]: 0,
      [RESOURCE_CONTENTION_REASON_CODES.DRAFT_ALLOCATION_CONTENTION]: 0,
    },
    affectedProjectCount: 2,
    affectedResourceCount: 2,
    totalContentions,
    sourceFreshness: [
      {
        source: 'resource_allocation',
        lastUpdatedAt: '2026-09-10T00:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 60,
        status: 'visible',
      },
    ],
    warnings: [],
    evidenceHashes: ['hash-1'],
  }
}

function contentionItem(): ResourceContentionItem {
  return {
    contentionId: CONTENTION_ID,
    severity: RESOURCE_CONTENTION_SEVERITIES.CRITICAL,
    reasonCode: RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD,
    resourceId: 11,
    resourceName: '张三',
    projectIds: [9, 10],
    projectNames: ['项目甲', '项目乙'],
    taskId: 99,
    allocationId: 5,
    from: '2026-09-01',
    to: '2026-09-07',
    loadPercent: 130,
    affectedDateBuckets: ['2026-09-01'],
    description: '张三 跨项目合计分配 130%，超过可用容量。',
    remediationHint: '建议下调其中一条分配的分配比例。',
    evidenceHash: 'ehash-1',
    target: { kind: 'resource', href: '/organization/resource-pool', authorized: true },
    redactionState: 'visible',
    createdAt: '2026-09-10T00:00:00.000Z',
  }
}

function contentionMatrix(): ResourceContentionMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    rows: [
      {
        resourceId: 11,
        resourceName: '张三',
        role: 'developer',
        totalContentions: 1,
        maxSeverity: RESOURCE_CONTENTION_SEVERITIES.CRITICAL,
        cells: [
          {
            date: '2026-09-01',
            severity: RESOURCE_CONTENTION_SEVERITIES.CRITICAL,
            reasonCode: RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD,
            loadPercent: 130,
            contentionCount: 1,
            redactionState: 'visible',
            drillDownTarget: null,
          },
        ],
        redactionState: 'visible',
      },
    ],
  }
}

function contentionSuggestion(): ResourceContentionSuggestionPreview {
  return {
    suggestionId: 'SG-1',
    contentionId: CONTENTION_ID,
    kind: 'rule',
    title: '下调项目乙的分配比例',
    description: '把项目乙的分配比例从 60% 降到 30%，即可回到容量之内。',
    candidateActions: ['把项目乙的分配比例从 60% 降到 30%', '与项目乙负责人确认优先级'],
    isAdvisory: true,
    redactionState: 'visible',
    createdAt: '2026-09-10T00:00:00.000Z',
  }
}

const ITEMS_META = { total: 1, page: 1, perPage: 20, totalPages: 1 }

function installHappyBackend(totalContentions = 3) {
  return installBackend([
    [
      '/resource-contentions/summary',
      () => jsonResponse(200, { data: contentionSummary(totalContentions) }),
    ],
    [
      '/resource-contentions/items',
      () =>
        jsonResponse(200, {
          data: totalContentions > 0 ? [contentionItem()] : [],
          meta:
            totalContentions > 0 ? ITEMS_META : { total: 0, page: 1, perPage: 20, totalPages: 0 },
        }),
    ],
    ['/resource-contentions/matrix', () => jsonResponse(200, { data: contentionMatrix() })],
    [`${CONTENTION_ID}/suggestions`, () => jsonResponse(200, { data: [contentionSuggestion()] })],
    [`/resource-contentions/${CONTENTION_ID}`, () => jsonResponse(200, { data: contentionItem() })],
  ])
}

// ── 会话与渲染 ──────────────────────────────────────────────────────────────

function setOrganizationContext() {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'contention-viewer@example.com',
      fullName: '争用观察员',
      organizations: [{ id: ORG_ID, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: accessTokenWith(['resource:view'], { organizationId: ORG_ID }),
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
  return render(<ResourceContentionDetectionPage />, { wrapper })
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
// 有数据：矩阵视图
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨资源争用页 · 矩阵视图', () => {
  test('严重度摘要与矩阵行真实渲染（非错误态主导）', async () => {
    installHappyBackend()
    renderPage()

    expect(await screen.findByText('资源争用检测')).toBeInTheDocument()

    // 严重度摘要区（4 张卡）
    expect(await screen.findByRole('region', { name: '争用严重度摘要' })).toBeInTheDocument()
    expect(screen.getAllByText('严重').length).toBeGreaterThan(0)

    // 矩阵视图（默认）表格与资源行
    expect(screen.getByRole('grid', { name: '资源争用矩阵' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument()
    })

    expect(screen.queryByText('加载资源争用数据失败，请刷新重试。')).not.toBeInTheDocument()
    expect(screen.queryByText('暂未检测到资源争用')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 有数据：列表视图 + 建议动作区（W1 修复后首次可渲染）
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨资源争用页 · 列表视图与建议区', () => {
  test('展开争用条目后建议动作区渲染（修复前恒不渲染）', async () => {
    const fetchMock = installHappyBackend()
    renderPage()

    await screen.findByText('资源争用检测')

    await act(async () => {
      screen.getByRole('radio', { name: '列表视图' }).click()
    })

    // 列表项（信封端点 items）
    const listItem = await screen.findByRole('listitem')
    expect(listItem.textContent).toContain('张三 跨项目合计分配 130%')

    await act(async () => {
      listItem.click()
    })

    // 详情面板 + 建议动作区（单键 `{data: [...]}` 端点，修复前 hook 解成 undefined）
    expect(await screen.findByText('处置建议')).toBeInTheDocument()
    expect(await screen.findByText('建议动作（仅供参考，不自动执行）：')).toBeInTheDocument()
    expect(screen.getByText('把项目乙的分配比例从 60% 降到 30%')).toBeInTheDocument()
    expect(
      screen.getByText('以上建议仅供审查，不会自动修改分配、任务负责人、任务日期或工作日历。'),
    ).toBeInTheDocument()

    const urls = fetchMock.mock.calls.map((call) =>
      String(call[0] instanceof URL ? call[0].href : call[0]),
    )
    expect(
      urls.some((url) => url.includes(`/resource-contentions/${CONTENTION_ID}/suggestions`)),
    ).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 空数据：空态而不是崩溃／错误态
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨资源争用页 · 空数据', () => {
  test('totalContentions 为 0 时渲染空态', async () => {
    installHappyBackend(0)
    renderPage()

    expect(await screen.findByText('暂未检测到资源争用')).toBeInTheDocument()
    expect(screen.queryByText('加载资源争用数据失败，请刷新重试。')).not.toBeInTheDocument()
  })
})
