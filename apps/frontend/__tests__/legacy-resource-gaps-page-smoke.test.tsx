/**
 * v3-legacy-contract-debt-fixes W6 · tasks 6.3 —— 旧轨资源缺口页渲染级冒烟（M9／R1 承接）。
 *
 * 页面：`app/(dashboard)/organization/resource-gaps/page.tsx`（此前无任何 page 级渲染测试）。
 * 手法与四个信封测试一致：`vi.stubGlobal('fetch', …)` 伪后端按**后端真实响应形状**应答 +
 * 真实 auth store 提供组织上下文，让 `fetch → apiFetch / apiFetchEnvelope → api client →
 * hook → 页面` 整条链路真实执行（不 mock hooks、不 mock `@/lib/api/*`）。
 *
 * 断言口径（task 6.3）：渲染不抛错、关键数据区块出现（非「加载失败／空错误态」主导）、
 * 空数据不崩、4xx 落可辨识错误态而不是白屏或假空态。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import {
  RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
  type ResourceGapEntry,
  type ResourceGapMeta,
  type ResourceGapSummary,
} from '@aiproj/types'
import ResourceGapWorkbench from '@/app/(dashboard)/organization/resource-gaps/page'

// ── next/navigation 桩（页面用 useSearchParams 恢复 URL 状态 + useRouter 写回） ──

const navMock = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() },
  search: new URLSearchParams(),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => navMock.search,
  useRouter: () => navMock.router,
  usePathname: () => '/organization/resource-gaps',
  useParams: () => ({}),
}))

// ── 伪后端 ──────────────────────────────────────────────────────────────────

const ORG_ID = 7

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/**
 * 按 URL 片段路由；未命中返回 500 而不是静默成功，避免测试悄悄跑在残缺后端上。
 * 顺序即优先级（summary 与各维度端点的片段互不为前缀）。
 */
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

// ── 后端真实载荷（`{ data: … }` 里那个 `…`） ────────────────────────────────

function gapMeta(): ResourceGapMeta {
  return {
    calculatedAt: '2026-09-10T00:00:00.000Z',
    metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
    organizationId: ORG_ID,
    actorId: 1,
    querySignatureHash: 'a1b2c3d4',
    visibleProjectCount: 2,
    visibleResourceCount: 5,
    dateWindow: { from: '2026-06-08', to: '2026-09-10' },
    upstreamAvailability: {
      demandForecasting: true,
      contentionDetection: true,
      skillMatrix: true,
      resourcePool: true,
    },
    sourceFreshness: { allocation: '2026-09-10T00:00:00.000Z' },
  }
}

function gapEntry(overrides: Partial<ResourceGapEntry> = {}): ResourceGapEntry {
  return {
    gapId: 'gap-skill-backend',
    dimension: 'skill',
    dimensionValue: 'backend',
    dimensionLabel: '后端工程师',
    metric: 'allocated_vs_demand',
    severity: 'critical',
    demandHours: 320,
    supplyHours: 240,
    gapHours: 80,
    gapRatio: 0.25,
    dateWindow: { from: '2026-06-08', to: '2026-09-10' },
    reasons: [
      {
        code: 'NO_CANDIDATE_RESOURCE',
        label: '无候选资源',
        priority: 0,
        evidenceRefs: [],
        explanation: '组织中不存在具有所需技能的资源',
      },
    ],
    warnings: [],
    redacted: false,
    ...overrides,
  }
}

function gapSummary(overrides: Partial<ResourceGapSummary> = {}): ResourceGapSummary {
  const totalGaps = overrides.totalGaps ?? 3
  return {
    meta: gapMeta(),
    totalGaps,
    severityDistribution: { critical: 1, high: 1, medium: 1, low: 0, none: 0 },
    metricDistribution: {
      allocated_vs_demand: 3,
      available_vs_demand: 0,
      skill_shortfall: 0,
      forecast_gap: 0,
    },
    dimensionDistribution: {
      role: 1,
      skill: 1,
      timeBucket: 0,
      project: 1,
      portfolio: 0,
      organization: 0,
    },
    totalDemandHours: 320,
    totalSupplyHours: 240,
    totalGapHours: 80,
    averageGapRatio: 0.25,
    topGaps: [gapEntry()],
    warnings: [],
    ...overrides,
  }
}

function dimensionEnvelope(entries: ResourceGapEntry[]) {
  return {
    data: entries,
    meta: { total: entries.length, page: 1, perPage: 20, totalPages: entries.length ? 1 : 0 },
    warnings: [],
  }
}

/** 六个端点全 200：summary 走单键 `{data}`，五个维度端点走信封 `{data, meta, warnings}`。 */
function installHappyBackend(summary: ResourceGapSummary = gapSummary()) {
  const entries = [gapEntry()]
  return installBackend([
    ['/resource-gaps/summary', () => jsonResponse(200, { data: summary })],
    ['/resource-gaps/by-role', () => jsonResponse(200, dimensionEnvelope(entries))],
    ['/resource-gaps/by-skill', () => jsonResponse(200, dimensionEnvelope(entries))],
    ['/resource-gaps/by-timebucket', () => jsonResponse(200, dimensionEnvelope([]))],
    ['/resource-gaps/by-project', () => jsonResponse(200, dimensionEnvelope([]))],
    ['/resource-gaps/by-portfolio', () => jsonResponse(200, dimensionEnvelope([]))],
  ])
}

function installForbiddenBackend() {
  const body = { error: { code: 'PERMISSION_DENIED', message: '权限不足' } }
  const forbidden = () => jsonResponse(403, body)
  return installBackend([
    ['/resource-gaps/summary', forbidden],
    ['/resource-gaps/by-role', forbidden],
    ['/resource-gaps/by-skill', forbidden],
    ['/resource-gaps/by-timebucket', forbidden],
    ['/resource-gaps/by-project', forbidden],
    ['/resource-gaps/by-portfolio', forbidden],
  ])
}

// ── 会话与渲染 ──────────────────────────────────────────────────────────────

function setOrganizationContext() {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'gap-viewer@example.com',
      fullName: '缺口观察员',
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
  return render(<ResourceGapWorkbench />, { wrapper })
}

beforeEach(() => {
  navMock.search = new URLSearchParams()
  navMock.router.push.mockReset()
  navMock.router.replace.mockReset()
  setOrganizationContext()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// 有数据：关键区块渲染
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨资源缺口页 · 有数据', () => {
  test('摘要 KPI 与维度卡片真实渲染（非 undefined 穿透、非错误态主导）', async () => {
    const fetchMock = installHappyBackend()
    renderPage()

    // 页头 + 摘要统计
    expect(await screen.findByText('资源缺口分析')).toBeInTheDocument()
    expect(await screen.findByText('总缺口数')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('总缺口(h)')).toBeInTheDocument()

    // 维度卡片（默认 skill 维度，走 by-skill 信封端点）；卡片在网格与移动列表各渲染一次
    await waitFor(() => {
      expect(screen.getAllByText('后端工程师').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('严重缺口').length).toBeGreaterThan(0)

    // 关键端点确实被真实链路请求过（summary 单键 + by-skill 信封）
    const urls = fetchMock.mock.calls.map((call) =>
      String(call[0] instanceof URL ? call[0].href : call[0]),
    )
    expect(urls.some((url) => url.includes(`/organizations/${ORG_ID}/resource-gaps/summary`))).toBe(
      true,
    )
    expect(urls.some((url) => url.includes('/resource-gaps/by-skill'))).toBe(true)

    // 不得是错误／空态主导
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无缺口数据')).not.toBeInTheDocument()
    expect(screen.queryByText('请先选择组织')).not.toBeInTheDocument()
  })

  test('切换维度 tab 不崩溃：by-role 信封端点被请求', async () => {
    const fetchMock = installHappyBackend()
    renderPage()

    await screen.findByText('总缺口数')
    const roleTab = screen.getByRole('button', { name: '角色' })
    await act(async () => {
      roleTab.click()
    })

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) =>
        String(call[0] instanceof URL ? call[0].href : call[0]),
      )
      expect(urls.some((url) => url.includes('/resource-gaps/by-role'))).toBe(true)
    })
    expect(screen.getAllByText('后端工程师').length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 空数据：走空态而不是崩溃
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨资源缺口页 · 空数据', () => {
  test('totalGaps 为 0 时渲染空态横幅，不抛错', async () => {
    installHappyBackend(
      gapSummary({
        totalGaps: 0,
        severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
        metricDistribution: {
          allocated_vs_demand: 0,
          available_vs_demand: 0,
          skill_shortfall: 0,
          forecast_gap: 0,
        },
        dimensionDistribution: {
          role: 0,
          skill: 0,
          timeBucket: 0,
          project: 0,
          portfolio: 0,
          organization: 0,
        },
        totalDemandHours: 0,
        totalSupplyHours: 0,
        totalGapHours: 0,
        averageGapRatio: 0,
        topGaps: [],
      }),
    )
    renderPage()

    expect(await screen.findByText('暂无缺口数据')).toBeInTheDocument()
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4xx：可辨识错误态（RL-06），不退化为白屏或假空态
// ═══════════════════════════════════════════════════════════════════════════

describe('旧轨资源缺口页 · 4xx', () => {
  test('summary 403 时渲染错误横幅而不是空白页', async () => {
    installForbiddenBackend()
    renderPage()

    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(screen.queryByText('暂无缺口数据')).not.toBeInTheDocument()
  })
})
