/**
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.8 —— 资源缺口分析工作台组件测试。
 *
 * 覆盖（spec「组织资源池与资源缺口分析」+ tasks 4.8）：
 * - 五维切换写回 URL 且状态可恢复；切换后对应维度数据/图表内容生效；
 * - ECharts 图表渲染冒烟（echarts-core jsdom 桩捕获 setOption，series 数据映射）；
 * - 空态（维度无条目 / 组织无缺口）与错误重试闭环；
 * - 一切筛选/切换/下钻交互零写请求（全局 fetch 监控零记录，RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ensureLazyEchartsMock,
  FakeEChartsInstance,
  getEchartsMockBundle,
} from './helpers/echarts-mock'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { GapAnalysisWorkspace } from '@/components/next/org-gaps/GapAnalysisWorkspace'
import type { ResourceGapEnvelope, ResourceGapEntry } from '@aiproj/types'

// ---------------------------------------------------------------------------
// ECharts jsdom 桩（design §8.1）
// ---------------------------------------------------------------------------
vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      const instance = new FakeEChartsInstance(dom)
      bundle.instances.push(instance)
      bundle.lastDom = dom
      return instance
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

// ---------------------------------------------------------------------------
// next/navigation mock（URL 为筛选唯一事实来源）
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
// 数据层 mock：summary 走 api client（工作台补偿直连），维度走既有 hooks
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
// 会话 / 夹具
// ---------------------------------------------------------------------------
function setAuth() {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'viewer@example.com',
      fullName: '资源观察员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['resource:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

interface HookResult {
  data?: ResourceGapEnvelope<ResourceGapEntry[]>
  isLoading: boolean
  isError: boolean
  refetch: ReturnType<typeof vi.fn>
}

function hookResult(entries: ResourceGapEntry[], overrides: Partial<HookResult> = {}): HookResult {
  return {
    data: { data: entries, meta: { total: entries.length, page: 1, perPage: 20, totalPages: 1 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

let nextGapId = 1000
function makeEntry(overrides: Partial<ResourceGapEntry> = {}): ResourceGapEntry {
  const id = `gap-${nextGapId++}`
  return {
    gapId: id,
    dimension: 'skill',
    dimensionValue: '前端开发',
    dimensionLabel: '前端开发',
    metric: 'allocated_vs_demand',
    severity: 'high',
    demandHours: 200,
    supplyHours: 120,
    gapHours: 80,
    gapRatio: 0.4,
    dateWindow: { from: '2026-09-01', to: '2026-09-30' },
    reasons: [
      {
        code: 'SKILL_ORG_WIDE_SHORTAGE',
        label: '全组织技能短缺',
        priority: 1,
        evidenceRefs: [],
        explanation: '组织中此技能持有者不足',
      },
    ],
    warnings: [],
    redacted: false,
    ...overrides,
  }
}

function makeSummary(totalGaps: number) {
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

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
function installDefaultBackend() {
  gapApiMock.summary.mockResolvedValue(makeSummary(2))
  const skillEntries = [
    makeEntry({ dimensionLabel: '前端开发', dimension: 'skill', severity: 'high', gapHours: 80 }),
  ]
  const roleEntries = [
    makeEntry({
      dimensionLabel: '后端开发',
      dimension: 'role',
      severity: 'critical',
      gapHours: 120,
    }),
  ]
  const idle = {
    data: {
      data: [] as ResourceGapEntry[],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    },
  }
  hooksMock.byRole.mockReturnValue(hookResult(roleEntries))
  hooksMock.bySkill.mockReturnValue(hookResult(skillEntries))
  hooksMock.byTimebucket.mockReturnValue({
    ...idle,
    isLoading: false,
    isError: false,
    refetch: vi.fn(() => Promise.resolve()),
  })
  hooksMock.byProject.mockReturnValue({
    ...idle,
    isLoading: false,
    isError: false,
    refetch: vi.fn(() => Promise.resolve()),
  })
  hooksMock.byPortfolio.mockReturnValue({
    ...idle,
    isLoading: false,
    isError: false,
    refetch: vi.fn(() => Promise.resolve()),
  })
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

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GapAnalysisWorkspace />
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
  ensureLazyEchartsMock().reset()
  navMock.replace.mockReset()
  navMock.push.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  useNextTrackStore.setState({ immersionTier: null })
  setAuth()
  resetAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

interface OptionShape {
  animation?: boolean
  xAxis?: { data?: unknown[] }
  series?: Array<{
    name?: string
    type?: string
    data?: Array<{ value?: number; name?: string; itemStyle?: { color?: string } }>
  }>
}

function lastOption(): OptionShape {
  return (getEchartsMockBundle().lastOption ?? {}) as OptionShape
}

describe('GapAnalysisWorkspace：维度切换与 URL 状态（tasks 4.8）', () => {
  test('默认技能维度：摘要 + 图表 + 条目明细渲染，series 数据映射正确（冒烟）', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    expect(container.querySelector('[data-gap-stats]')).not.toBeNull()
    expect(container.querySelector('[data-gap-chart]')).not.toBeNull()
    await waitFor(() => {
      expect(getEchartsMockBundle().instances.length).toBeGreaterThan(0)
    })
    const option = lastOption()
    expect(option.animation).toBe(true)
    expect(option.series?.[0]?.type).toBe('bar')
    expect(option.series?.[0]?.data).toHaveLength(1)
    expect(option.series?.[0]?.data?.[0]).toEqual(
      expect.objectContaining({ value: 80, name: '前端开发' }),
    )
    expect(container.querySelector('[data-gap-entry-card]')).not.toBeNull()
  })

  test('维度切换写回 URL（dimension=role），URL 恢复后渲染对应维度数据', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())

    fireEvent.click(screen.getByRole('tab', { name: '角色' }))
    expect(navMock.replace).toHaveBeenCalledWith(
      '/next/organization/resource-gaps?dimension=role',
      { scroll: false },
    )

    searchParamsMock.value = new URLSearchParams('dimension=role')
    const { container: next } = renderWorkspace()
    // 角色维度条目（critical 严重缺口 120h）渲染
    await waitFor(() =>
      expect(next.querySelector('[data-gap-entry-card]')?.textContent ?? '').toContain('后端开发'),
    )
    expect(hooksMock.byRole).toHaveBeenCalled()
    const lastOptionAfter = lastOption()
    expect(lastOptionAfter.series?.[0]?.data?.[0]).toEqual(expect.objectContaining({ value: 120 }))
  })

  test('URL 携带 metric/severity/topN 时解析为查询并恢复', async () => {
    searchParamsMock.value = new URLSearchParams(
      'dimension=project&metric=forecast_gap&severity=critical&topN=20',
    )
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    expect(hooksMock.byProject).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: ['forecast_gap'],
        severity: 'critical',
        topN: 20,
      }),
    )
    expect(container.querySelector('[data-gap-filter-severity]')).not.toBeNull()
  })

  test('筛选交互写回 URL 并重查（只读）', async () => {
    const { records } = installFetchSpy()
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())

    fireEvent.change(container.querySelector('[data-gap-filter-metric]') as Element, {
      target: { value: 'skill_shortfall' },
    })
    expect(navMock.replace).toHaveBeenLastCalledWith(
      '/next/organization/resource-gaps?dimension=skill&metric=skill_shortfall',
      { scroll: false },
    )
    fireEvent.change(container.querySelector('[data-gap-filter-severity]') as Element, {
      target: { value: 'critical' },
    })
    expect(navMock.replace).toHaveBeenLastCalledWith(
      '/next/organization/resource-gaps?dimension=skill&severity=critical',
      { scroll: false },
    )
    fireEvent.change(container.querySelector('[data-gap-filter-topn]') as Element, {
      target: { value: '50' },
    })
    expect(navMock.replace).toHaveBeenLastCalledWith(
      '/next/organization/resource-gaps?dimension=skill&topN=50',
      { scroll: false },
    )
    expect(records.length).toBe(0)
  })
})

describe('GapAnalysisWorkspace：图表渲染与下钻（tasks 4.8）', () => {
  test('点击条目卡就地展开原因解读（reasons），再次点击收起', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-entry-card]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-gap-entry-card]') as Element)
    await waitFor(() => expect(container.querySelector('[data-gap-detail]')).not.toBeNull())
    expect(container.querySelector('[data-gap-reason="SKILL_ORG_WIDE_SHORTAGE"]')).not.toBeNull()
    expect(container.textContent).toContain('全组织技能短缺')

    fireEvent.click(container.querySelector('[data-gap-entry-card]') as Element)
    await waitFor(() => expect(container.querySelector('[data-gap-detail]')).toBeNull())
  })

  test('redacted 条目中性呈现且不入图', async () => {
    hooksMock.bySkill.mockReturnValue(
      hookResult([
        makeEntry({ gapId: 'gap-hidden', redacted: true, dimensionLabel: '隐藏项', gapHours: 500 }),
      ]),
    )
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-entry-redacted]')).not.toBeNull())
    expect(container.querySelector('[data-gap-entry-redacted]')?.textContent).toContain('已脱敏')
    // 图表空模型：无可见柱体 → 空态（不入图，也不初始化图表实例）
    expect(getEchartsMockBundle().instances.length).toBe(0)
    expect(container.querySelector('[data-gap-chart]')).toBeNull()
    expect(container.querySelector('[data-gap-chart-empty]')).not.toBeNull()
  })

  test('precise 档图表动画归零（animation=false）', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    await waitFor(() => {
      expect(getEchartsMockBundle().instances.length).toBeGreaterThan(0)
    })
    expect(lastOption().animation).toBe(false)
  })
})

describe('GapAnalysisWorkspace：空态与错误重试（tasks 4.8）', () => {
  test('组织无缺口（totalGaps=0）：全局空态引导', async () => {
    gapApiMock.summary.mockResolvedValue(makeSummary(0))
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-empty]')).not.toBeNull())
    expect(container.textContent).toContain('暂无缺口数据')
  })

  test('summary 加载失败：错误卡 + 重试恢复', async () => {
    gapApiMock.summary.mockRejectedValueOnce(new Error('network down'))
    gapApiMock.summary.mockResolvedValue(makeSummary(2))
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-error]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-gap-retry]') as Element)
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
  })

  test('维度分区错误：图表错误卡 + 重试恢复', async () => {
    const refetch = vi.fn(() => Promise.resolve())
    hooksMock.bySkill.mockReturnValue(hookResult([], { isError: true, refetch, data: undefined }))
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-chart-error]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-gap-chart-retry]') as Element)
    expect(refetch).toHaveBeenCalled()
  })

  test('维度条目为空：图表空态（可切换其他维度）', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    // 时间桶维度无条目 → 空态
    searchParamsMock.value = new URLSearchParams('dimension=timeBucket')
    const { container: next } = renderWorkspace()
    await waitFor(() => expect(next.querySelector('[data-gap-chart-empty]')).not.toBeNull())
  })
})

describe('GapAnalysisWorkspace：零写请求（tasks 4.8 / RL-01）', () => {
  test('切换/筛选/下钻全流程零真实 fetch（无写方法）', async () => {
    const { records } = installFetchSpy()
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-gap-workspace]')).not.toBeNull())
    // 先下钻（默认技能维有条目），再切换维度（组合维空态）
    fireEvent.click(container.querySelector('[data-gap-entry-card]') as Element)
    fireEvent.click(screen.getByRole('tab', { name: '组合' }))
    expect(records.length).toBe(0)
  })
})
